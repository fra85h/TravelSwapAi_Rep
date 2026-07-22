-- PUNTO 1b — Scadenza della prenotazione.
--
-- Con la conferma a due lati (20260721190000) l'accettazione mette gli
-- annunci in 'reserved' e li ci lascia finché entrambe le parti non
-- confermano o una annulla. Ma se nessuno fa nulla, gli annunci restano
-- bloccati fuori dal mercato PER SEMPRE. Serve una finestra: se la
-- prenotazione non si chiude entro N giorni, si rilascia da sola e gli
-- annunci tornano attivi — stesso schema pigro già usato per le offerte
-- pending (48h) e per gli annunci scaduti.
--
-- Finestra: 7 giorni (l'handover di un biglietto può richiedere qualche
-- giorno; più lunga della finestra pending di 48h).

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamp with time zone;

-- Prenotazioni già in corso (accepted senza scadenza): dà loro comunque una
-- finestra a partire dall'ultimo aggiornamento, così anche quelle vecchie si
-- liberano invece di restare appese.
UPDATE public.offers
   SET reservation_expires_at = coalesce(updated_at, now()) + interval '7 days'
 WHERE status = 'accepted' AND reservation_expires_at IS NULL;

-- accept_offer_any: come la versione precedente, ma imposta anche la
-- scadenza della prenotazione.
CREATE OR REPLACE FUNCTION public.accept_offer_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
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

-- Rilascio pigro: chiamato all'apertura di Attività da ciascuna parte,
-- libera le PROPRIE prenotazioni scadute (annunci -> active, offerta
-- 'cancelled'). Scoped a chi chiama, come expire_my_stale_listings.
CREATE OR REPLACE FUNCTION public.release_my_stale_reservations()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  r record;
begin
  for r in
    select o.id, o.to_listing_id, o.from_listing_id
    from public.offers o
    join public.listings tl on tl.id = o.to_listing_id
    where o.status = 'accepted'
      and o.reservation_expires_at is not null
      and o.reservation_expires_at < now()
      and (o.proposer_id = auth.uid() or tl.user_id = auth.uid())
  loop
    update public.listings set status = 'active'
     where id in (r.to_listing_id, coalesce(r.from_listing_id, r.to_listing_id))
       and status = 'reserved';
    update public.offers
       set status = 'cancelled', owner_confirmed_at = null, proposer_confirmed_at = null
     where id = r.id;
  end loop;
end $$;
GRANT EXECUTE ON FUNCTION public.release_my_stale_reservations() TO authenticated;

-- get_offer_handshake: espone anche la scadenza prenotazione (countdown).
-- DROP necessario: cambia le colonne di ritorno (aggiunge reservation_expires_at)
-- e CREATE OR REPLACE non può cambiare il tipo di ritorno di una funzione.
DROP FUNCTION IF EXISTS public.get_offer_handshake(text);
CREATE FUNCTION public.get_offer_handshake(offer_id_text text)
RETURNS TABLE(status text, type text, amount numeric, currency text, i_confirmed boolean, other_confirmed boolean, reservation_expires_at timestamp with time zone)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  select
    o.status::text, o.type, o.amount, o.currency,
    case when tl.user_id = auth.uid() then o.owner_confirmed_at is not null
         else o.proposer_confirmed_at is not null end,
    case when tl.user_id = auth.uid() then o.proposer_confirmed_at is not null
         else o.owner_confirmed_at is not null end,
    o.reservation_expires_at
  from public.offers o
  join public.listings tl on tl.id = o.to_listing_id
  where o.id::text = offer_id_text
    and (o.proposer_id = auth.uid() or tl.user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.get_offer_handshake(text) TO authenticated;
