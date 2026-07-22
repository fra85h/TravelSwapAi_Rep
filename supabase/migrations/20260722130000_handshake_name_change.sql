-- Step "cambio nominativo" guidato nel post-accettazione.
--
-- Problema: per un biglietto nominativo (listings.is_named_ticket), chi lo
-- riceve deve farlo reintestare presso l'operatore, ma questo non era mai
-- segnalato nel momento in cui conta davvero — dopo l'accettazione, mentre
-- si organizza lo scambio in chat. Chi compra scopriva il vincolo da solo (o
-- non lo scopriva affatto) e rischiava un biglietto inutilizzabile.
--
-- Fix: get_offer_handshake espone anche se il biglietto che l'utente
-- CORRENTE sta ricevendo è nominativo (e il relativo operatore, per
-- indicazioni mirate Trenitalia/Italo). "Ricevo" = to_listing se sono il
-- proponente, from_listing se sono il proprietario del target ED è uno
-- scambio (in un BUY il proprietario del target riceve denaro, non un
-- biglietto). Nessuno stato persistito: il promemoria resta visibile finché
-- lo scambio non è confermato/annullato, senza un nuovo step da tracciare.
DROP FUNCTION IF EXISTS public.get_offer_handshake(text);
CREATE FUNCTION public.get_offer_handshake(offer_id_text text)
RETURNS TABLE(status text, type text, amount numeric, currency text, i_confirmed boolean, other_confirmed boolean, reservation_expires_at timestamp with time zone, disputed boolean, dispute_reason text, needs_name_change boolean, ticket_operator text)
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
         else null end
  from public.offers o
  join public.listings tl on tl.id = o.to_listing_id
  left join public.listings fl on fl.id = o.from_listing_id
  where o.id::text = offer_id_text
    and (o.proposer_id = auth.uid() or tl.user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.get_offer_handshake(text) TO authenticated;
