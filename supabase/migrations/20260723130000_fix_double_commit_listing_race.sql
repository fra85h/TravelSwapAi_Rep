-- Bug reale, riprodotto da un caso in produzione: un annuncio può finire
-- impegnato in DUE scambi/acquisti diversi contemporaneamente, perché
-- accept_offer_any non ri-verifica MAI che l'annuncio offerto in cambio
-- (from_listing_id) sia ancora 'active' al momento dell'accettazione — lo
-- controlla solo before_insert_offers_enforce, ma quello scatta alla
-- CREAZIONE della proposta, non alla sua accettazione (che può avvenire
-- molto dopo, con nel frattempo un'ALTRA proposta che usa lo stesso
-- from_listing_id già accettata).
--
-- Sequenza che riproduce il bug:
--   1) Utente propone lo stesso proprio annuncio A in scambio verso B e
--      verso C (due proposte 'pending' distinte, entrambe legittime: A era
--      'active' quando sono state create).
--   2) B accetta -> A e B diventano 'reserved' (corretto).
--   3) C accetta -> A e C diventano 'reserved' di nuovo: NESSUN controllo
--      impediva di sovrascrivere la prenotazione di A, che era già
--      impegnata per lo scambio con B (bug: qui doveva fermarsi).
--   4) Lo scambio A<->B arriva a conferma doppia per primo -> A e B
--      diventano 'swapped' (trigger after_update_offers_propagate). OK.
--   5) Lo scambio A<->C arriva a conferma doppia -> prova a impostare A
--      (già 'swapped' dal passo 4) di nuovo a 'swapped': il trigger
--      before_update_listings_lock_terminal lo blocca con un errore grezzo
--      mostrato direttamente all'utente ("listing X is already swapped:
--      concluded listings cannot be modified") proprio nel momento della
--      conferma finale, con l'altra parte già confermata in attesa.
--
-- Fix in due punti:
--   A) accept_offer_any: prima di riservare, verifica che TUTTI gli annunci
--      coinvolti (to_listing_id e, se c'è, from_listing_id) siano ANCORA
--      'active' in questo momento (con lock per evitare la stessa race fra
--      due accettazioni concorrenti) — se non lo sono più, l'offerta non
--      viene accettata: passa a 'expired', stesso trattamento già esistente
--      per data di viaggio passata (stesso messaggio lato client: "non più
--      valida"). Chiude il buco alla radice per le nuove accettazioni.
--   B) confirm_exchange_any: backstop per gli scambi che sono RIUSCITI ad
--      accettarsi in conflitto PRIMA di questo fix (o per qualunque altra
--      causa futura non prevista) — se al momento della doppia conferma uno
--      degli annunci coinvolti risulta già in uno stato concluso altrove,
--      annulla questa proposta ('cancelled', libera il lato non ancora
--      concluso) invece di far esplodere il trigger con un errore grezzo.
--      Il motivo si marca in offers.cancel_reason (stesso schema già usato
--      per dispute_reason) con un CODICE breve, non una frase — la frase
--      va tradotta lato client (it/en/es), il DB non sa in che lingua è
--      l'utente. Resta NULL per un annullamento volontario (Annulla
--      scambio): il client distingue i due casi da lì.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS cancel_reason text;

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

  -- Lock sugli annunci coinvolti PRIMA di leggerne lo stato: se due
  -- accettazioni concorrenti condividono lo stesso from_listing_id, la
  -- seconda aspetta che la prima finisca (commit) invece di leggere uno
  -- stato ormai superato.
  perform 1 from public.listings l
  where l.id::text = v_offer.to_listing_id::text
     or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text)
  for update;

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

  -- Uno degli annunci coinvolti non è più 'active' (già impegnato in
  -- un'ALTRA proposta accettata nel frattempo): stesso trattamento del
  -- viaggio passato, la proposta non è più valida.
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

  -- Si conferma solo un'offerta accettata e non ancora finalizzata.
  if v_offer.status <> 'accepted' then return v_offer; end if;

  if v_is_owner then
    update public.offers set owner_confirmed_at = coalesce(owner_confirmed_at, now()) where id = v_offer.id;
  else
    update public.offers set proposer_confirmed_at = coalesce(proposer_confirmed_at, now()) where id = v_offer.id;
  end if;
  select * into v_offer from public.offers where id = v_offer.id;

  -- Entrambe confermate -> finalizza (il trigger propaga swapped/sold) e
  -- registra le transazioni 'completed'.
  if v_offer.owner_confirmed_at is not null and v_offer.proposer_confirmed_at is not null then
    -- Backstop: uno dei due annunci potrebbe essere già concluso altrove
    -- (vedi commento in testa al file). Non tentare di riscriverne lo
    -- stato: il trigger before_update_listings_lock_terminal fallirebbe
    -- con un errore grezzo mostrato all'utente proprio ora, alla conferma.
    select bool_or(l.status::text in ('sold','swapped','exchanged','traded'))
      into v_conflicted
    from public.listings l
    where l.id::text = v_offer.to_listing_id::text
       or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text);

    if coalesce(v_conflicted, false) then
      update public.offers
         set status = 'cancelled', cancel_reason = 'listing_unavailable'
       where id = v_offer.id;
      -- libera il lato NON già concluso altrove (l'altro è terminale,
      -- toccarlo fallirebbe comunque per lo stesso motivo).
      update public.listings set status = 'active'
       where (id::text = v_offer.to_listing_id::text
              or (v_offer.from_listing_id is not null and id::text = v_offer.from_listing_id::text))
         and status::text not in ('sold','swapped','exchanged','traded');
      select * into v_offer from public.offers where id = v_offer.id;
      return v_offer;
    end if;

    update public.offers set status = 'finalized' where id = v_offer.id;

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

-- get_offer_handshake: espone anche cancel_reason (il client lo usa per
-- distinguere un annullamento volontario da uno automatico per conflitto,
-- vedi ChatScreen.js — stesso schema già usato per dispute_reason).
DROP FUNCTION IF EXISTS public.get_offer_handshake(text);
CREATE FUNCTION public.get_offer_handshake(offer_id_text text)
RETURNS TABLE(status text, type text, amount numeric, currency text, i_confirmed boolean, other_confirmed boolean, reservation_expires_at timestamp with time zone, disputed boolean, dispute_reason text, needs_name_change boolean, ticket_operator text, cancel_reason text)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  select
    o.status::text, o.type, o.amount, o.currency,
    case when tl.user_id = auth.uid() then o.owner_confirmed_at is not null
         else o.proposer_confirmed_at is not null end,
    case when tl.user_id = auth.uid() then o.proposer_confirmed_at is not null
         else o.owner_confirmed_at is not null end,
    o.reservation_expires_at,
    o.disputed_at is not null,
    o.dispute_reason,
    case when o.proposer_id = auth.uid() then coalesce(tl.is_named_ticket, false)
         when tl.user_id = auth.uid() and o.type = 'swap' then coalesce(fl.is_named_ticket, false)
         else false end,
    case when o.proposer_id = auth.uid() then tl.operator
         when tl.user_id = auth.uid() and o.type = 'swap' then fl.operator
         else null end,
    o.cancel_reason
  from public.offers o
  join public.listings tl on tl.id = o.to_listing_id
  left join public.listings fl on fl.id = o.from_listing_id
  where o.id::text = offer_id_text
    and (o.proposer_id = auth.uid() or tl.user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.get_offer_handshake(text) TO authenticated;
