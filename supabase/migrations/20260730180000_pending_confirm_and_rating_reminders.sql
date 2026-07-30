-- ============================================================
-- Analisi empatia/toni amichevoli, sezione C punto 10: reminder proattivi
-- assenti. Oggi nessuno spinge l'utente a confermare uno scambio già
-- accettato ("hai ricevuto tutto quello che ti aspettavi?") né a valutare
-- una transazione finalizzata — si conta solo sull'iniziativa spontanea di
-- riaprire l'app.
--
-- Precondizione mancante: offers non aveva NESSUN timestamp dedicato per
-- "quando è diventata accepted" o "quando è diventata finalized" (solo
-- updated_at generico, toccato anche da conferme/dispute/cancel — non
-- utilizzabile come soglia affidabile). Aggiunte accepted_at/finalized_at,
-- scritte da accept_offer_any/confirm_exchange_any (basate sulle versioni
-- più recenti: 20260729140000_decline_siblings_on_from_listing_too.sql e
-- 20260729150000_confirm_exchange_blocks_on_dispute.sql).
--
-- Due nuovi RPC di manutenzione, stesso schema di
-- remind_stale_chain_confirmers (20260730170000): SECURITY DEFINER, nessun
-- filtro auth.uid(), un promemoria per offerta (confirm_reminder_sent_at /
-- rating_reminder_sent_at evitano di rispedirlo ogni volta che gira il
-- cron), agganciati a POST /api/offers/recompute (già esistente, già
-- protetto da requireCronSecret).
-- ============================================================

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS accepted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS finalized_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS confirm_reminder_sent_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS rating_reminder_sent_at timestamp with time zone;

-- ------------------------------------------------------------
-- accept_offer_any: unica modifica, scrive accepted_at insieme allo
-- status. Base: versione più recente (20260729140000, decline sui due
-- annunci di uno scambio).
-- ------------------------------------------------------------
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
end $$;

-- ------------------------------------------------------------
-- confirm_exchange_any: unica modifica, scrive finalized_at insieme allo
-- status. Base: versione più recente (20260729150000, blocco su
-- disputed_at).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_exchange_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
  v_is_owner boolean;
  v_conflicted boolean;
begin
  select * into v_offer from public.offers where id::text = offer_id_text for update;
  if not found then raise exception 'Offer not found'; end if;

  select user_id into v_owner from public.listings where id::text = v_offer.to_listing_id::text;

  v_is_owner := (v_owner = auth.uid());
  if not (v_is_owner or v_offer.proposer_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;

  if v_offer.status <> 'accepted' then return v_offer; end if;

  if v_offer.disputed_at is not null then return v_offer; end if;

  if v_is_owner then
    update public.offers set owner_confirmed_at = coalesce(owner_confirmed_at, now()) where id = v_offer.id;
  else
    update public.offers set proposer_confirmed_at = coalesce(proposer_confirmed_at, now()) where id = v_offer.id;
  end if;
  select * into v_offer from public.offers where id = v_offer.id;

  if v_offer.owner_confirmed_at is not null and v_offer.proposer_confirmed_at is not null then
    perform 1 from public.listings l
    where l.id::text = v_offer.to_listing_id::text
       or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text)
    order by l.id
    for update;

    select bool_or(l.status::text in ('sold','swapped','exchanged','traded'))
      into v_conflicted
    from public.listings l
    where l.id::text = v_offer.to_listing_id::text
       or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text);

    if coalesce(v_conflicted, false) then
      update public.offers
         set status = 'cancelled', cancel_reason = 'listing_unavailable'
       where id = v_offer.id;
      update public.listings set status = 'active'
       where (id::text = v_offer.to_listing_id::text
              or (v_offer.from_listing_id is not null and id::text = v_offer.from_listing_id::text))
         and status::text not in ('sold','swapped','exchanged','traded');
      select * into v_offer from public.offers where id = v_offer.id;
      return v_offer;
    end if;

    update public.offers set status = 'finalized', finalized_at = now() where id = v_offer.id;

    if v_offer.type = 'swap' and v_offer.from_listing_id is not null then
      insert into public.transactions (listing_id, seller_id, buyer_id, ttype, price, status)
      values
        (v_offer.to_listing_id,   v_owner,             v_offer.proposer_id, 'swap', null, 'completed'),
        (v_offer.from_listing_id, v_offer.proposer_id, v_owner,             'swap', null, 'completed');
    else
      insert into public.transactions (listing_id, seller_id, buyer_id, ttype, price, status)
      values (v_offer.to_listing_id, v_owner, v_offer.proposer_id, 'sale', v_offer.amount, 'completed');
    end if;

    select * into v_offer from public.offers where id = v_offer.id;
  end if;

  return v_offer;
end $$;

-- ------------------------------------------------------------
-- Promemoria "hai ricevuto tutto quello che ti aspettavi? conferma".
-- Esclude le offerte contestate (disputed_at): lì non serve un nudge a
-- confermare, serve una risoluzione (vedi resolve_exchange_dispute).
-- ------------------------------------------------------------
CREATE FUNCTION public.remind_pending_confirmations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  r record;
  n int := 0;
begin
  for r in
    select o.id, o.proposer_id, o.owner_confirmed_at, o.proposer_confirmed_at,
           o.to_listing_id, o.type, l.user_id as owner_id, l.title as listing_title
    from public.offers o
    join public.listings l on l.id = o.to_listing_id
    where o.status = 'accepted'
      and o.disputed_at is null
      and o.confirm_reminder_sent_at is null
      and o.accepted_at is not null
      and o.accepted_at < now() - interval '24 hours'
      and (o.owner_confirmed_at is null or o.proposer_confirmed_at is null)
  loop
    if r.owner_confirmed_at is null then
      insert into public.notifications (user_id, type, title, body, data)
      values (
        r.owner_id,
        'offer_confirm_reminder',
        '📬 Com''è andato lo scambio?',
        coalesce('Sono passate 24 ore da quando hai accettato la proposta su «' || r.listing_title || '»: se hai ricevuto tutto quello che ti aspettavi, conferma con un tap — chiude lo scambio per entrambi. 😊',
                 'Sono passate 24 ore dall''accettazione: se hai ricevuto tutto quello che ti aspettavi, conferma con un tap. 😊'),
        jsonb_build_object('offerId', r.id, 'listingId', r.to_listing_id, 'offerType', r.type)
      );
    end if;
    if r.proposer_confirmed_at is null then
      insert into public.notifications (user_id, type, title, body, data)
      values (
        r.proposer_id,
        'offer_confirm_reminder',
        '📬 Com''è andato lo scambio?',
        coalesce('Sono passate 24 ore da quando la tua proposta su «' || r.listing_title || '» è stata accettata: se hai ricevuto tutto quello che ti aspettavi, conferma con un tap — chiude lo scambio per entrambi. 😊',
                 'Sono passate 24 ore dall''accettazione: se hai ricevuto tutto quello che ti aspettavi, conferma con un tap. 😊'),
        jsonb_build_object('offerId', r.id, 'listingId', r.to_listing_id, 'offerType', r.type)
      );
    end if;
    update public.offers set confirm_reminder_sent_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

REVOKE ALL ON FUNCTION public.remind_pending_confirmations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remind_pending_confirmations() TO service_role;

-- ------------------------------------------------------------
-- Promemoria "valuta la tua esperienza", 3 giorni dopo la finalizzazione
-- (margine prima che il double-blind si sveli comunque da solo a 14
-- giorni, vedi get_user_rating). Un solo insert per parte che non ha
-- ancora votato quella specifica offerta.
-- ------------------------------------------------------------
CREATE FUNCTION public.remind_pending_ratings() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  r record;
  n int := 0;
begin
  for r in
    select o.id, o.proposer_id, o.to_listing_id, o.type, l.user_id as owner_id, l.title as listing_title
    from public.offers o
    join public.listings l on l.id = o.to_listing_id
    where o.status = 'finalized'
      and o.finalized_at is not null
      and o.finalized_at < now() - interval '3 days'
      and o.rating_reminder_sent_at is null
  loop
    if not exists (select 1 from public.transaction_ratings where offer_id = r.id and rater_id = r.owner_id) then
      insert into public.notifications (user_id, type, title, body, data)
      values (
        r.owner_id,
        'offer_rating_reminder',
        '⭐ Com''è stata l''esperienza?',
        coalesce('Il tuo scambio su «' || r.listing_title || '» si è concluso qualche giorno fa: lascia una valutazione, aiuta la community a scambiare con più fiducia. Bastano due tap! 🙌',
                 'Il tuo scambio si è concluso qualche giorno fa: lascia una valutazione, aiuta la community a scambiare con più fiducia. 🙌'),
        jsonb_build_object('offerId', r.id, 'listingId', r.to_listing_id, 'offerType', r.type)
      );
    end if;
    if r.proposer_id is not null and not exists (select 1 from public.transaction_ratings where offer_id = r.id and rater_id = r.proposer_id) then
      insert into public.notifications (user_id, type, title, body, data)
      values (
        r.proposer_id,
        'offer_rating_reminder',
        '⭐ Com''è stata l''esperienza?',
        coalesce('Il tuo scambio su «' || r.listing_title || '» si è concluso qualche giorno fa: lascia una valutazione, aiuta la community a scambiare con più fiducia. Bastano due tap! 🙌',
                 'Il tuo scambio si è concluso qualche giorno fa: lascia una valutazione, aiuta la community a scambiare con più fiducia. 🙌'),
        jsonb_build_object('offerId', r.id, 'listingId', r.to_listing_id, 'offerType', r.type)
      );
    end if;
    update public.offers set rating_reminder_sent_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

REVOKE ALL ON FUNCTION public.remind_pending_ratings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remind_pending_ratings() TO service_role;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('offer_received','offer_accepted','offer_declined','new_matches',
                  'listing_ping','listing_question','listing_question_answered',
                  'chain_canceled','offer_cancelled','dispute_resolved',
                  'offer_confirm_reminder','offer_rating_reminder'));
