-- ============================================================
-- Fix: confirm_chain_participant() registrava il buyer_id sbagliato
-- nelle transazioni di uno scambio a catena (3 lati).
--
-- create_chain_proposal() valida il ciclo così: chi dà il listing in
-- posizione j+1 lo dà a chi sta in posizione j (v_next_give == v_recv).
-- Cioè: il destinatario del listing dato da un partecipante è chi ha
-- QUEL listing come proprio receive_listing_id — non "la posizione
-- successiva" come calcolava erroneamente confirm_chain_participant
-- (next_user_id = position+1, direzione opposta a quella validata).
--
-- Risultato del bug: ogni riga transactions creata da uno scambio a 3
-- completato aveva seller_id corretto (il proprietario che cede) ma
-- buyer_id sbagliato (il partecipante nella direzione opposta del
-- ciclo, non chi riceve davvero quel listing). Lo storico "Attività >
-- Storico" mostrava quindi il lato "ricevuto" sbagliato a tutti e 3 i
-- partecipanti di ogni catena completata. La UI della catena in corso
-- non è mai stata affetta: legge receive_listing_id direttamente dalla
-- riga (vedi lib/chains.js), non lo ricalcola per posizione.
--
-- Fix: sostituito il calcolo per posizione con una join diretta su
-- receive_listing_id = give_listing_id — corretto per definizione,
-- niente aritmetica di posizione da ricordare nella direzione giusta.
-- ============================================================

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
    update public.listings set status = 'reserved' where id = v_participant.give_listing_id;

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

-- ------------------------------------------------------------
-- expire_old_chain_proposals: era priva delle REVOKE/GRANT che
-- restringono le altre funzioni "solo manutenzione" di questo file
-- (create_chain_proposal) a service_role — di default un utente
-- autenticato poteva chiamarla via RPC. Impatto reale nullo (la WHERE
-- comunque non fa scadere nulla prima del tempo), ma incoerente col
-- design dichiarato ("da chiamare periodicamente lato server").
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.expire_old_chain_proposals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_old_chain_proposals() TO service_role;

-- ------------------------------------------------------------
-- Fix dati storici: corregge il buyer_id delle transazioni già
-- generate da scambi a catena completati PRIMA di questo fix, con la
-- stessa logica corretta sopra (destinatario = chi ha questo listing
-- come proprio receive_listing_id).
-- ------------------------------------------------------------
UPDATE public.transactions t
SET buyer_id = correct.buyer_id
FROM (
  SELECT
    cp.give_listing_id AS listing_id,
    cp.user_id AS seller_id,
    buyer.user_id AS buyer_id
  FROM public.chain_participants cp
  JOIN public.chain_proposals ch ON ch.id = cp.chain_id AND ch.status = 'completed'
  JOIN public.chain_participants buyer
    ON buyer.chain_id = cp.chain_id AND buyer.receive_listing_id = cp.give_listing_id
) correct
WHERE t.listing_id = correct.listing_id
  AND t.seller_id = correct.seller_id
  AND t.ttype = 'swap'
  AND t.buyer_id <> correct.buyer_id;
