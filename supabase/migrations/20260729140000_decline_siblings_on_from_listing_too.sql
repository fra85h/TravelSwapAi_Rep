-- Bug trovato scrivendo il test funzionale sulla proposta/accettazione
-- (checklist manuale, Parte 3): quando si accetta uno SCAMBIO,
-- accept_offer_any riserva sia to_listing_id sia from_listing_id (l'annuncio
-- ceduto in cambio), ma declinava le altre proposte pending SOLO su
-- to_listing_id. Un terzo utente con un'offerta pending su from_listing_id
-- restava "in sospeso" a tempo indeterminato invece di ricevere subito la
-- notifica di rifiuto (con l'incoraggiamento aggiunto in
-- 20260729130000_friendly_offer_declined_notification.sql) — nessuna
-- corruzione di dati (il controllo v_unavailable più sotto la fa comunque
-- scadere se qualcuno prova ad accettarla dopo), ma un'esperienza sbagliata:
-- quella persona non sa mai che la sua proposta è già morta.
--
-- Riparte dall'ultima versione (20260726120000_data_integrity_hardening.sql,
-- lock ordinato su ORDER BY l.id): unica modifica, la query di declino ora
-- copre entrambi gli annunci coinvolti, stesso idioma coalesce(...,
-- '____none____') già usato poco sopra nella stessa funzione per il caso
-- "annuncio passato".
CREATE OR REPLACE FUNCTION public.accept_offer_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
           (l.type = 'train' and l.depart_at is not null and l.depart_at < now())
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
     set status = 'accepted', reservation_expires_at = now() + interval '7 days'
   where id = v_offer.id;

  -- Fix: prima copriva solo to_listing_id. Per uno scambio, from_listing_id
  -- viene riservato qui sotto esattamente come to_listing_id: le altre
  -- proposte pending su ENTRAMBI vanno declinate allo stesso modo, non solo
  -- su uno dei due.
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
end $$;
