-- PUNTO 1c — Contestazione dello scambio ("segnala un problema").
--
-- Rete di sicurezza durante la prenotazione: se una parte non riceve ciò che
-- ha concordato (biglietto mai consegnato, non valido/già usato, ecc.), non
-- deve avere come unica scelta "confermare" o "annullare in silenzio". Può
-- SEGNALARE un problema: la prenotazione resta aperta ma marcata come
-- contestata, la conferma viene bloccata per entrambi finché non si risolve,
-- e il motivo appare in chat. Non c'è escrow: questo è un deterrente + traccia
-- + un blocco esplicito alla chiusura affrettata, non un arbitrato automatico.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS disputed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS disputed_by uuid,
  ADD COLUMN IF NOT EXISTS dispute_reason text;

-- Segnala un problema su un'offerta accettata (prenotazione in corso). Marca
-- la contestazione e pubblica il motivo come messaggio in chat, così è
-- visibile a entrambe le parti nel thread. SECURITY DEFINER: il filtro
-- interno (parte dell'offerta) fa da guardia; l'insert del messaggio bypassa
-- la RLS ma con sender_id = auth.uid() (il segnalante).
CREATE OR REPLACE FUNCTION public.report_exchange_problem(offer_id_text text, reason_text text)
RETURNS public.offers
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_offer public.offers;
  v_owner uuid;
  v_reason text := nullif(btrim(coalesce(reason_text, '')), '');
begin
  select * into v_offer from public.offers where id::text = offer_id_text for update;
  if not found then raise exception 'Offer not found'; end if;

  select user_id into v_owner from public.listings where id::text = v_offer.to_listing_id::text;
  if not (v_owner = auth.uid() or v_offer.proposer_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;

  -- Si contesta solo una prenotazione ancora aperta.
  if v_offer.status <> 'accepted' then return v_offer; end if;

  update public.offers
     set disputed_at = now(), disputed_by = auth.uid(),
         dispute_reason = coalesce(v_reason, 'Problema segnalato')
   where id = v_offer.id;

  insert into public.chat_messages (offer_id, sender_id, body)
  values (v_offer.id, auth.uid(), '⚠️ ' || coalesce(v_reason, 'Ho segnalato un problema con questo scambio.'));

  select * into v_offer from public.offers where id = v_offer.id;
  return v_offer;
end $$;
GRANT EXECUTE ON FUNCTION public.report_exchange_problem(text, text) TO authenticated;

-- get_offer_handshake: aggiunge stato contestazione.
DROP FUNCTION IF EXISTS public.get_offer_handshake(text);
CREATE FUNCTION public.get_offer_handshake(offer_id_text text)
RETURNS TABLE(status text, type text, amount numeric, currency text, i_confirmed boolean, other_confirmed boolean, reservation_expires_at timestamp with time zone, disputed boolean, dispute_reason text)
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
    o.dispute_reason
  from public.offers o
  join public.listings tl on tl.id = o.to_listing_id
  where o.id::text = offer_id_text
    and (o.proposer_id = auth.uid() or tl.user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.get_offer_handshake(text) TO authenticated;

-- list_my_chats: espone anche la contestazione (per l'indicatore in Attività).
DROP FUNCTION IF EXISTS public.list_my_chats();
CREATE FUNCTION public.list_my_chats()
RETURNS TABLE(
  offer_id text, type text, status text,
  to_listing_id text, to_listing_title text, from_listing_title text,
  last_body text, last_at timestamp with time zone,
  unread_count integer, updated_at timestamp with time zone,
  i_confirmed boolean, other_confirmed boolean, disputed boolean
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
         else o.owner_confirmed_at is not null end,
    o.disputed_at is not null
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
