-- PUNTO 3 (casi limite) — Niente accettazione su un viaggio già passato.
--
-- Buco: l'annuncio scade in modo "pigro" (solo quando il proprietario apre i
-- propri annunci). Quindi un annuncio per un treno GIÀ PARTITO poteva restare
-- 'active' e la sua proposta pending poteva essere accettata — si finalizzava
-- lo scambio di un biglietto ormai inutile. Ora l'accettazione controlla la
-- data: se il viaggio (di uno qualsiasi dei due lati, per lo swap) è passato,
-- l'offerta viene scaduta e gli annunci marcati 'expired' invece di accettare.
--
-- accept_offer_any basata sulla versione più recente
-- (20260721200000_reservation_timeout.sql), conservandone la scadenza
-- prenotazione; aggiunge solo il controllo data.

CREATE OR REPLACE FUNCTION public.accept_offer_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
  v_passed boolean;
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

  -- Data del viaggio passata su UNO QUALSIASI degli annunci coinvolti?
  select bool_or(
           (l.type = 'train' and l.depart_at is not null and l.depart_at < now())
        or (l.type = 'hotel' and l.check_in  is not null and l.check_in::date < current_date)
         )
    into v_passed
  from public.listings l
  where l.id::text = v_offer.to_listing_id::text
     or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text);

  if coalesce(v_passed, false) then
    -- niente accettazione: scade l'offerta e marca scaduti gli annunci ancora attivi
    update public.offers set status = 'expired' where id = v_offer.id;
    update public.listings set status = 'expired'
     where id::text in (v_offer.to_listing_id::text, coalesce(v_offer.from_listing_id::text, '____none____'))
       and status = 'active';
    select * into v_offer from public.offers where id = v_offer.id;
    return v_offer;  -- status = 'expired' -> il client mostra "non accettabile"
  end if;

  update public.offers
     set status = 'accepted', reservation_expires_at = now() + interval '7 days'
   where id = v_offer.id;

  update public.offers set status = 'declined'
   where to_listing_id::text = v_offer.to_listing_id::text
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
end $$;
