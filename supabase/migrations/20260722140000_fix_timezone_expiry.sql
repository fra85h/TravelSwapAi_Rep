-- Fix fuso orario sulla scadenza hotel (check_in): CURRENT_DATE è valutato
-- nel fuso orario di SESSIONE del database (su Supabase, di default UTC), non
-- nel fuso dell'utente italiano. check_in è una `date` semplice (nessun
-- fuso incorporato) pensata come giorno di calendario italiano.
--
-- Bug dimostrato con Postgres reale: ogni notte, per ~1-2 ore dopo la
-- mezzanotte italiana (l'ampiezza dipende dall'ora legale, +1/+2h), è già
-- "domani" in Italia ma CURRENT_DATE (sessione UTC) pensa sia ancora "oggi".
-- In quella finestra un hotel con check_in = ieri (calendario italiano):
--   - NON viene marcato 'expired' da expire_my_stale_listings (resta
--     azionabile/prenotabile ore dopo che il check-in locale è finito);
--   - può ancora essere ACCETTATO da accept_offer_any (il controllo
--     "viaggio già passato" non scatta), finalizzando uno scambio su una
--     prenotazione ormai inutile.
-- Fix: sostituire CURRENT_DATE con (now() AT TIME ZONE 'Europe/Rome')::date,
-- esplicito e stabile qualunque sia il fuso di sessione del database
-- (gestisce il cambio ora legale/solare automaticamente, via tzdata).
--
-- depart_at/now() (treni) restano invariati: sono entrambi timestamptz,
-- il confronto tra due istanti assoluti non dipende dal fuso di sessione.

CREATE OR REPLACE FUNCTION public.expire_my_stale_listings()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.listings
     SET status = 'expired'
   WHERE user_id = auth.uid()
     AND status = 'active'
     AND (
       (type = 'train' AND depart_at IS NOT NULL AND depart_at < now())
       OR
       (type = 'hotel' AND check_in IS NOT NULL AND check_in::date < (now() AT TIME ZONE 'Europe/Rome')::date)
     );
$$;

GRANT EXECUTE ON FUNCTION public.expire_my_stale_listings() TO authenticated;

-- accept_offer_any basata sulla versione più recente (20260721230000), che
-- introduceva il controllo "viaggio già passato": stesso fix, stesso motivo.
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
        or (l.type = 'hotel' and l.check_in  is not null and l.check_in::date < (now() AT TIME ZONE 'Europe/Rome')::date)
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
