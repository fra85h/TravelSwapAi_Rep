-- ============================================================
-- Due race condition reali trovate in audit, stessa famiglia di bug già
-- corretta altrove in questo progetto (accept_offer_any/confirm_exchange_any,
-- 20260726120000): leggere lo stato di una riga e scriverci sopra più tardi
-- SENZA tenerla bloccata nel frattempo permette a una transazione concorrente
-- di infilarsi in mezzo con un commit che il codice non si aspettava.
--
-- release_my_stale_reservations basata sulla versione più recente
-- (20260721200000). confirm_chain_participant basata sulla versione più
-- recente (20260718100000_fix_chain_swap_buyer_direction).
-- ============================================================

-- ------------------------------------------------------------
-- 1) release_my_stale_reservations: nessun lock prima di scrivere
--
-- Il cursore legge le offerte con status='accepted' e reservation_expires_at
-- scaduta SENZA bloccarle, poi la UPDATE finale scrive status='cancelled'
-- SOLO per id, senza ricontrollare lo stato al momento della scrittura.
--
-- Scenario reale: la prenotazione sta per scadere proprio mentre entrambe le
-- parti confermano lo scambio negli ultimi istanti. confirm_exchange_any
-- finalizza correttamente (status='finalized', transazione registrata), ma
-- questa pulizia — partita da uno snapshot precedente — sovrascrive comunque
-- a 'cancelled' e azzera le conferme, anche se gli annunci restano
-- sold/swapped: l'offerta finita chat sparisce (list_my_chats filtra solo
-- accepted/finalized) pur essendo uno scambio realmente avvenuto.
--
-- Fix: si blocca la riga con SELECT ... FOR UPDATE e si ricontrolla lo stato
-- PRIMA di scrivere; se nel frattempo non è più 'accepted' (finalizzata o già
-- annullata da un'altra chiamata), si salta. La condizione status='accepted'
-- anche nella UPDATE finale resta come backstop, a costo zero.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_my_stale_reservations()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  r record;
  v_offer public.offers;
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
    -- Rilegge e blocca la riga PRIMA di scrivere: una finalizzazione
    -- concorrente (confirm_exchange_any) può committare 'finalized' dopo che
    -- questo cursore ha già preso lo snapshot iniziale.
    select * into v_offer from public.offers where id = r.id for update;
    if v_offer.status <> 'accepted' then
      continue;
    end if;

    update public.listings set status = 'active'
     where id in (r.to_listing_id, coalesce(r.from_listing_id, r.to_listing_id))
       and status = 'reserved';

    update public.offers
       set status = 'cancelled', owner_confirmed_at = null, proposer_confirmed_at = null
     where id = v_offer.id
       and status = 'accepted';
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2) confirm_chain_participant: annunci letti ma mai bloccati
--
-- Controlla che i 3 annunci della catena siano 'active' senza bloccarli
-- (nessun FOR UPDATE), poi li scrive a 'reserved' senza ricontrollare lo
-- stato — lo stesso identico bug che accept_offer_any aveva prima della
-- correzione in 20260726120000, mai propagato qui perché vive in un file
-- diverso.
--
-- Scenario reale: uno dei 3 annunci della catena riceve un'offerta 1:1
-- normale accettata nello stesso istante in cui la catena raggiunge la terza
-- conferma. Senza lock, la catena scrive comunque 'reserved' sopra e inserisce
-- una transactions in conflitto: lo stesso biglietto fisico finisce impegnato
-- con due controparti diverse.
--
-- Fix: lock ordinato (ORDER BY id, stesso ordine di accept_offer_any, per non
-- incastrarsi con lei se un annuncio è conteso da entrambe le parti) sui 3
-- annunci PRIMA di leggerne lo stato. status='active' anche nella UPDATE
-- finale di riserva, come backstop.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_chain_participant(p_chain_id uuid) RETURNS public.chain_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_chain public.chain_proposals;
  v_confirmed_count int;
  v_participant record;
  v_all_active boolean := true;
begin
  if not exists (
    select 1 from public.chain_participants
    where chain_id = p_chain_id and user_id = auth.uid()
  ) then
    raise exception 'Not a participant of this chain';
  end if;

  select * into v_chain from public.chain_proposals where id = p_chain_id for update;

  if v_chain.status = 'proposed' and v_chain.expires_at < now() then
    update public.chain_proposals set status = 'expired' where id = p_chain_id;
    select * into v_chain from public.chain_proposals where id = p_chain_id;
  end if;

  if v_chain.status <> 'proposed' then
    return v_chain;
  end if;

  update public.chain_participants
    set confirmed = true, confirmed_at = now()
  where chain_id = p_chain_id and user_id = auth.uid() and confirmed = false;

  select count(*) into v_confirmed_count
  from public.chain_participants where chain_id = p_chain_id and confirmed = true;

  if v_confirmed_count < 3 then
    select * into v_chain from public.chain_proposals where id = p_chain_id;
    return v_chain;
  end if;

  -- Lock ordinato sui 3 annunci PRIMA di leggerne lo stato: senza, un'offerta
  -- 1:1 su uno di questi annunci può essere accettata nello stesso istante
  -- in cui la catena raggiunge la terza conferma, e la UPDATE sotto
  -- scriverebbe 'reserved' sopra un annuncio già impegnato altrove.
  perform 1 from public.listings l
  where l.id in (
    select cp.give_listing_id from public.chain_participants cp where cp.chain_id = p_chain_id
  )
  order by l.id
  for update;

  for v_participant in
    select cp.give_listing_id, l.status as listing_status
    from public.chain_participants cp
    join public.listings l on l.id = cp.give_listing_id
    where cp.chain_id = p_chain_id
  loop
    if v_participant.listing_status <> 'active' then
      v_all_active := false;
    end if;
  end loop;

  if not v_all_active then
    update public.chain_proposals
      set status = 'canceled', canceled_reason = 'listing_no_longer_active'
    where id = p_chain_id;
    select * into v_chain from public.chain_proposals where id = p_chain_id;
    return v_chain;
  end if;

  for v_participant in
    select
      cp.user_id,
      cp.give_listing_id,
      (
        -- chi riceve QUESTO listing è chi lo ha come proprio
        -- receive_listing_id, non "la posizione successiva"
        select buyer.user_id from public.chain_participants buyer
        where buyer.chain_id = cp.chain_id and buyer.receive_listing_id = cp.give_listing_id
      ) as next_user_id
    from public.chain_participants cp
    where cp.chain_id = p_chain_id
  loop
    update public.listings set status = 'reserved'
      where id = v_participant.give_listing_id and status = 'active';

    update public.offers
      set status = 'declined'
    where (to_listing_id = v_participant.give_listing_id or from_listing_id = v_participant.give_listing_id)
      and status = 'pending';

    insert into public.transactions (listing_id, seller_id, buyer_id, ttype, price, status)
    values (v_participant.give_listing_id, v_participant.user_id, v_participant.next_user_id, 'swap', null, 'completed');
  end loop;

  update public.chain_proposals
    set status = 'completed', completed_at = now()
  where id = p_chain_id;

  select * into v_chain from public.chain_proposals where id = p_chain_id;
  return v_chain;
end $$;
