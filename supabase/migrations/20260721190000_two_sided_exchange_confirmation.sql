-- PUNTO 1 — Conferma scambio a DUE LATI.
--
-- Problema risolto: prima, all'accettazione, un'offerta di SCAMBIO marcava
-- subito ENTRAMBI gli annunci 'swapped' (stato terminale) e registrava due
-- transazioni 'completed'; un ACQUISTO metteva l'annuncio 'reserved' ma
-- registrava già la transazione come conclusa. In pratica registravamo il
-- valore PRIMA che lo scambio reale (consegna PNR / pagamento, che avviene
-- fuori dall'app) fosse avvenuto: se l'altra parte spariva, non c'era
-- rollback né disputa.
--
-- Nuovo flusso:
--   accettazione  -> offerta 'accepted', annunci 'reserved' (REVERSIBILE),
--                    NESSUNA transazione ancora.
--   conferma      -> ciascuna parte conferma che lo scambio è avvenuto;
--                    quando confermano ENTRAMBE l'offerta va 'finalized',
--                    gli annunci diventano 'swapped'/'sold' e si registrano
--                    le transazioni 'completed'.
--   annulla       -> finché non è finalizzata, ciascuna parte può annullare:
--                    gli annunci tornano 'active', l'offerta 'cancelled'.
--
-- Confronti sullo status sempre via ::text dove serve (trabocchetto enum,
-- vedi CLAUDE.md). accept_offer_any è basata sulla versione più recente
-- (20260718110001_offers_timeout.sql), conservandone la scadenza pigra.

-- 'finalized' referenziato da after_update_offers_propagate ma mai presente
-- nell'enum: aggiungiamolo. Usato solo DENTRO i corpi delle funzioni (a
-- runtime), mai eseguito in questa migration, quindi nessun problema di
-- "unsafe use of new enum value".
ALTER TYPE public.offer_status ADD VALUE IF NOT EXISTS 'finalized';

-- Timestamp di conferma per lato: owner = proprietario dell'annuncio target
-- (venditore), proposer = chi ha proposto l'offerta.
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS owner_confirmed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS proposer_confirmed_at timestamp with time zone;

-- ------------------------------------------------------------------
-- accept: RISERVA (reversibile), nessuna transazione anticipata
-- ------------------------------------------------------------------
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

  update public.offers set status = 'accepted' where id = v_offer.id;

  update public.offers set status = 'declined'
   where to_listing_id::text = v_offer.to_listing_id::text
     and id <> v_offer.id and status = 'pending';

  -- Prenotazione REVERSIBILE su entrambi i lati: niente più stato terminale
  -- all'accettazione. La transazione si registra solo alla conferma.
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

-- ------------------------------------------------------------------
-- confirm: registra la conferma del chiamante; se entrambe -> finalize
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_exchange_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
  v_is_owner boolean;
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

-- ------------------------------------------------------------------
-- cancel: finché non finalizzata, ripristina 'active' e annulla
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_accepted_offer_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
begin
  select * into v_offer from public.offers where id::text = offer_id_text for update;
  if not found then raise exception 'Offer not found'; end if;

  select user_id into v_owner from public.listings where id::text = v_offer.to_listing_id::text;
  if not (v_owner = auth.uid() or v_offer.proposer_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;

  if v_offer.status <> 'accepted' then return v_offer; end if;

  -- Prima riporta gli annunci riservati ad attivi (recompute non tocca
  -- 'reserved'), poi annulla l'offerta.
  update public.listings set status = 'active'
   where id::text in (v_offer.to_listing_id::text, coalesce(v_offer.from_listing_id::text, '____none____'))
     and status = 'reserved';

  update public.offers
     set status = 'cancelled', owner_confirmed_at = null, proposer_confirmed_at = null
   where id = v_offer.id;

  select * into v_offer from public.offers where id = v_offer.id;
  return v_offer;
end $$;

GRANT EXECUTE ON FUNCTION public.confirm_exchange_any(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_accepted_offer_any(text) TO authenticated;

-- ------------------------------------------------------------------
-- get_offer_handshake: stato conferma per la ChatScreen, indipendente dal
-- punto di ingresso (alert, card, sezione Chat).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_offer_handshake(offer_id_text text)
RETURNS TABLE(status text, type text, amount numeric, currency text, i_confirmed boolean, other_confirmed boolean)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  select
    o.status::text,
    o.type,
    o.amount,
    o.currency,
    case when tl.user_id = auth.uid() then o.owner_confirmed_at is not null
         else o.proposer_confirmed_at is not null end,
    case when tl.user_id = auth.uid() then o.proposer_confirmed_at is not null
         else o.owner_confirmed_at is not null end
  from public.offers o
  join public.listings tl on tl.id = o.to_listing_id
  where o.id::text = offer_id_text
    and (o.proposer_id = auth.uid() or tl.user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.get_offer_handshake(text) TO authenticated;

-- ------------------------------------------------------------------
-- list_my_chats: espone anche lo stato conferma (DROP+CREATE, cambia le
-- colonne di ritorno).
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_my_chats();
CREATE FUNCTION public.list_my_chats()
RETURNS TABLE(
  offer_id text, type text, status text,
  to_listing_id text, to_listing_title text, from_listing_title text,
  last_body text, last_at timestamp with time zone,
  unread_count integer, updated_at timestamp with time zone,
  i_confirmed boolean, other_confirmed boolean
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id::text, o.type, o.status::text,
    tl.id::text, tl.title, fl.title,
    lm.body, lm.created_at,
    COALESCE((
      SELECT count(*) FROM public.chat_messages m2
      WHERE m2.offer_id = o.id AND m2.read_at IS NULL AND m2.sender_id <> auth.uid()
    ), 0)::int,
    o.updated_at,
    case when tl.user_id = auth.uid() then o.owner_confirmed_at is not null
         else o.proposer_confirmed_at is not null end,
    case when tl.user_id = auth.uid() then o.proposer_confirmed_at is not null
         else o.owner_confirmed_at is not null end
  FROM public.offers o
  JOIN public.listings tl ON tl.id = o.to_listing_id
  LEFT JOIN public.listings fl ON fl.id = o.from_listing_id
  LEFT JOIN LATERAL (
    SELECT m.body, m.created_at FROM public.chat_messages m
    WHERE m.offer_id = o.id ORDER BY m.created_at DESC LIMIT 1
  ) lm ON true
  WHERE o.status::text IN ('accepted', 'finalized')
    AND (o.proposer_id = auth.uid() OR tl.user_id = auth.uid())
  ORDER BY COALESCE(lm.created_at, o.updated_at) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_chats() TO authenticated;
