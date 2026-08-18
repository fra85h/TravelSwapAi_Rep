-- Scadenza dei treni: confrontare l'ora di partenza con l'orologio ITALIANO.
--
-- depart_at è un orario "da parete": indica l'ora ALLA STAZIONE e va mostrato
-- identico a chiunque lo guardi, da qualunque fuso. Per questo l'app lo salva
-- naive — la stringa "2026-08-18T09:00" arriva senza offset e Postgres, in
-- sessione UTC (il default su Supabase), la memorizza come 09:00+00 — e lo
-- rilegge in UTC (vedi formatWallClock in lib/wallClock.mjs). La convenzione
-- è voluta e va bene: il difetto è che la colonna NON contiene un istante
-- assoluto, mentre now() sì.
--
-- Dimostrazione del danno, su Postgres reale:
--   select '2026-08-18T09:00'::timestamptz;                       -> 09:00+00
--   select ('2026-08-18T09:00'::timestamptz at time zone 'Europe/Rome'); -> 11:00
-- Un treno che parte alle 09:00 italiane è registrato come 09:00+00, cioè le
-- 11:00 italiane. Fino a quell'ora `depart_at < now()` è falso:
--   - expire_my_stale_listings non lo marca 'expired';
--   - accept_offer_any non fa scattare il ramo "viaggio già passato" e
--     ACCETTA l'offerta, chiudendo uno scambio su un biglietto di un treno
--     partito da due ore (una d'inverno);
--   - notify_on_offer sbaglia il motivo della scadenza nella notifica.
-- La finestra è larga quanto l'offset italiano: +2h con l'ora legale, +1h con
-- quella solare.
--
-- Il fix NON tocca i dati: sposta il confronto sullo stesso piano del dato.
-- _wall_now() è l'orologio italiano di adesso riletto come se fosse UTC —
-- esattamente la convenzione con cui depart_at è scritto — quindi il
-- confronto torna a essere fra due grandezze omogenee.
--
--   ora legale:  now() = 12:00+00 -> ora italiana 14:00 -> _wall_now() = 14:00+00
--                un treno delle 13:00 (salvato 13:00+00) risulta partito. Giusto.
--   ora solare:  now() = 12:00+00 -> ora italiana 13:00 -> _wall_now() = 13:00+00
--
-- check_in/check_out non sono toccati: sono colonne `date`, senza fuso, e il
-- loro confronto era già stato corretto in 20260722140000.
--
-- Le tre funzioni qui sotto sono riprese TALI E QUALI dalla loro versione più
-- recente (estratte con pg_get_functiondef da un database con tutte le
-- migration applicate in ordine, come impone CLAUDE.md), con la SOLA modifica
-- di `depart_at < now()` in `depart_at < public._wall_now()`. Nessun'altra
-- riga è cambiata: è il modo per non ripetere la regressione di
-- 20260717120000, dove riscrivere una funzione da una base vecchia fece
-- perdere un fix già applicato.

CREATE OR REPLACE FUNCTION public._wall_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  -- L'ora italiana di adesso, riletta come se fosse UTC: la stessa
  -- convenzione con cui depart_at/arrive_at sono salvati.
  SELECT (now() AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC';
$$;

COMMENT ON FUNCTION public._wall_now() IS
  'Orologio "da parete" italiano espresso come timestamptz UTC. Da usare per confrontare le colonne salvate naive (listings.depart_at, listings.arrive_at) con l''istante corrente.';

-- Non espone nulla: è now() letto in un altro fuso. Serve però a chiunque
-- esegua le funzioni qui sotto, che girano con i privilegi del chiamante.
GRANT EXECUTE ON FUNCTION public._wall_now() TO anon, authenticated, service_role;


-- expire_my_stale_listings
CREATE OR REPLACE FUNCTION public.expire_my_stale_listings()
 RETURNS void
 LANGUAGE sql
AS $function$
  UPDATE public.listings
     SET status = 'expired'
   WHERE user_id = auth.uid()
     AND status = 'active'
     AND (
       (type = 'train' AND depart_at IS NOT NULL AND depart_at < public._wall_now())
       OR
       (type = 'hotel' AND check_in IS NOT NULL AND check_in::date < (now() AT TIME ZONE 'Europe/Rome')::date)
     );

  UPDATE public.offers o
     SET status = 'expired'
   WHERE o.status = 'pending'
     AND EXISTS (
       SELECT 1
         FROM public.listings l
        WHERE l.user_id = auth.uid()
          AND l.status::text IN ('expired','deleted','sold','swapped','exchanged','archived')
          AND (l.id = o.to_listing_id OR l.id = o.from_listing_id)
     );
$function$;

-- accept_offer_any
CREATE OR REPLACE FUNCTION public.accept_offer_any(offer_id_text text)
 RETURNS offers
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_offer public.offers;
  v_owner uuid;
  v_passed boolean;
  v_unavailable boolean;
begin
  select * into v_offer from public.offers where id::text = offer_id_text for update;
  if not found then raise exception 'Offer not found'; end if;

  if v_offer.status = 'pending' and v_offer.expires_at < now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    select * into v_offer from public.offers where id = v_offer.id;
  end if;

  select user_id into v_owner from public.listings where id::text = v_offer.to_listing_id::text;
  if v_owner is null or v_owner <> auth.uid() then raise exception 'Not allowed'; end if;

  if v_offer.status <> 'pending' then return v_offer; end if;

  perform 1 from public.listings l
  where l.id::text = v_offer.to_listing_id::text
     or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text)
  order by l.id
  for update;

  select bool_or(
           (l.type = 'train' and l.depart_at is not null and l.depart_at < public._wall_now())
        or (l.type = 'hotel' and l.check_in  is not null and l.check_in::date < (now() AT TIME ZONE 'Europe/Rome')::date)
         )
    into v_passed
  from public.listings l
  where l.id::text = v_offer.to_listing_id::text
     or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text);

  if coalesce(v_passed, false) then
    update public.offers set status = 'expired' where id = v_offer.id;
    update public.listings set status = 'expired'
     where id::text in (v_offer.to_listing_id::text, coalesce(v_offer.from_listing_id::text, '____none____'))
       and status = 'active';
    select * into v_offer from public.offers where id = v_offer.id;
    return v_offer;
  end if;

  select bool_or(l.status::text <> 'active')
    into v_unavailable
  from public.listings l
  where l.id::text = v_offer.to_listing_id::text
     or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text);

  if coalesce(v_unavailable, true) then
    update public.offers set status = 'expired' where id = v_offer.id;
    select * into v_offer from public.offers where id = v_offer.id;
    return v_offer;
  end if;

  update public.offers
     set status = 'accepted', reservation_expires_at = now() + interval '7 days', accepted_at = now()
   where id = v_offer.id;

  update public.offers set status = 'declined'
   where to_listing_id::text in (
           v_offer.to_listing_id::text,
           coalesce(v_offer.from_listing_id::text, '____none____')
         )
     and id <> v_offer.id and status = 'pending';

  if v_offer.type = 'swap' and v_offer.from_listing_id is not null then
    update public.listings set status = 'reserved'
     where id::text in (v_offer.to_listing_id::text, v_offer.from_listing_id::text);
  else
    update public.listings set status = 'reserved'
     where id::text = v_offer.to_listing_id::text;
  end if;

  select * into v_offer from public.offers where id = v_offer.id;
  return v_offer;
end $function$;

-- notify_on_offer
CREATE OR REPLACE FUNCTION public.notify_on_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_title text;
  v_notify_user uuid;
  v_listing_gone boolean;
begin
  if (tg_op = 'INSERT') then
    select l.user_id, l.title into v_owner, v_title
      from public.listings l where l.id = new.to_listing_id;
    if v_owner is not null
       and v_owner is distinct from new.proposer_id then
      insert into public.notifications (user_id, type, title, body, data)
      values (
        v_owner,
        'offer_received',
        case when new.type = 'swap' then 'Nuova proposta di scambio'
             else 'Nuova offerta di acquisto' end,
        coalesce('Su «' || v_title || '»', 'Hai ricevuto una proposta'),
        jsonb_build_object('offerId', new.id, 'listingId', new.to_listing_id, 'offerType', new.type)
      );
    end if;
    return new;
  end if;

  if (tg_op = 'UPDATE') and (new.status is distinct from old.status) then
    if new.status::text in ('accepted','declined') and new.proposer_id is not null then
      select l.title into v_title from public.listings l where l.id = new.to_listing_id;
      insert into public.notifications (user_id, type, title, body, data)
      values (
        new.proposer_id,
        case when new.status::text = 'accepted' then 'offer_accepted' else 'offer_declined' end,
        case when new.status::text = 'accepted' then 'Proposta accettata' else 'Proposta rifiutata' end,
        case when new.status::text = 'accepted' then
          coalesce('La tua proposta su «' || v_title || '» è stata accettata', 'La tua proposta è stata accettata')
        else
          coalesce('La tua proposta su «' || v_title || '» è stata rifiutata. Non ti scoraggiare: nuove occasioni simili arrivano ogni giorno, riprova! 💪',
                   'La tua proposta è stata rifiutata. Non ti scoraggiare: nuove occasioni simili arrivano ogni giorno, riprova! 💪')
        end,
        jsonb_build_object('offerId', new.id, 'listingId', new.to_listing_id, 'offerType', new.type)
      );

    elsif old.status::text = 'pending' and new.status::text = 'expired' and new.proposer_id is not null then
      select l.title into v_title from public.listings l where l.id = new.to_listing_id;

      -- Perché è morta: annuncio non più disponibile, oppure tempo finito.
      -- Si guardano ENTRAMBI i lati e sia lo stato sia la data del viaggio:
      -- in accept_offer_any il ramo "viaggio già passato" scade l'offerta
      -- PRIMA di marcare gli annunci, quindi al momento di questo trigger
      -- lo stato può ancora essere 'active' mentre la data è passata.
      select bool_or(
               l.status::text <> 'active'
            or (l.type = 'train' and l.depart_at is not null and l.depart_at < public._wall_now())
            or (l.type = 'hotel' and l.check_in is not null
                and l.check_in::date < (now() AT TIME ZONE 'Europe/Rome')::date)
             )
        into v_listing_gone
      from public.listings l
      where l.id = new.to_listing_id
         or (new.from_listing_id is not null and l.id = new.from_listing_id);

      insert into public.notifications (user_id, type, title, body, data)
      values (
        new.proposer_id,
        'offer_expired',
        'Proposta scaduta',
        case when coalesce(v_listing_gone, false) then
          coalesce('La tua proposta su «' || v_title || '» è scaduta: l''annuncio non è più disponibile. Cerca fra le occasioni simili, ne arrivano di nuove ogni giorno.',
                   'La tua proposta è scaduta: l''annuncio non è più disponibile.')
        else
          coalesce('La tua proposta su «' || v_title || '» è scaduta senza risposta. Puoi riproporla, l''annuncio è ancora lì.',
                   'La tua proposta è scaduta senza risposta.')
        end,
        jsonb_build_object('offerId', new.id, 'listingId', new.to_listing_id, 'offerType', new.type)
      );

    elsif old.status::text = 'accepted' and new.status::text = 'cancelled' and new.cancelled_by is not null then
      select l.user_id, l.title into v_owner, v_title from public.listings l where l.id = new.to_listing_id;
      v_notify_user := case when new.cancelled_by = v_owner then new.proposer_id else v_owner end;
      if v_notify_user is not null then
        insert into public.notifications (user_id, type, title, body, data)
        values (
          v_notify_user,
          'offer_cancelled',
          'Scambio annullato',
          case when new.cancel_reason is not null and new.cancel_reason <> 'listing_unavailable' then
            coalesce('L''altra parte ha annullato lo scambio su «' || v_title || '». Motivo: ' || new.cancel_reason,
                     'L''altra parte ha annullato lo scambio.')
          else
            coalesce('L''altra parte ha annullato lo scambio su «' || v_title || '».',
                     'L''altra parte ha annullato lo scambio.')
          end,
          jsonb_build_object('offerId', new.id, 'listingId', new.to_listing_id, 'offerType', new.type)
        );
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$function$;
