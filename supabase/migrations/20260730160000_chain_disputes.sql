-- ============================================================
-- Threat-modeling fase post-transazione (sezione A, punto 3, parte 2/2):
-- prima di questa migration non esisteva ALCUN meccanismo di
-- segnalazione/disputa per gli scambi a 3 (verificato con grep incrociato
-- su tutte le migrations e su server/src/models/chains.js) — l'equivalente
-- di report_exchange_problem per i 1:1 semplicemente non aveva mai un
-- corrispettivo per le catene. Un solo partecipante disonesto in una
-- catena a 3 danneggia DUE persone innocenti contemporaneamente, ed era
-- l'asimmetria più pericolosa emersa dall'analisi.
--
-- Decisione presa con l'utente: la segnalazione scatta SOLO dopo la
-- finalizzazione (chain 'completed' — le tre transazioni sono già
-- registrate, i tre annunci già marcati come scambiati). A differenza dei
-- 1:1, qui non c'è nulla da "bloccare": non esiste un concetto di
-- annullamento di una catena già completata in questo modello (le tre
-- transazioni sono già un fatto compiuto), quindi resolve_chain_dispute
-- (sotto) si limita a CHIUDERE la disputa con un esito informativo/di
-- reputazione, senza toccare transazioni o annunci — diversamente da
-- resolve_exchange_dispute, che invece può ancora annullare un'offerta
-- 'accepted' non ancora finalizzata.
--
-- Nuova tabella dedicata (non colonne su chain_participants): una
-- segnalazione è sempre reporter→accused, e un partecipante ha DUE
-- controparti possibili — un singolo booleano/timestamp su
-- chain_participants non basterebbe a dire CONTRO CHI dei due.
-- ============================================================

CREATE TABLE public.chain_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES public.chain_proposals(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accused_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,
  resolution_note text,
  CONSTRAINT chain_disputes_not_self CHECK (reporter_id <> accused_id),
  -- Una segnalazione aperta per coppia reporter/accusato/catena: evita
  -- doppie segnalazioni identiche premendo due volte lo stesso bottone
  -- (non impedisce una NUOVA segnalazione dopo che la prima è risolta,
  -- perché a quel punto la union con resolved_at is null nell'indice
  -- sotto la esclude).
  CONSTRAINT chain_disputes_reason_len CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000)
);

CREATE UNIQUE INDEX chain_disputes_one_open_per_pair
  ON public.chain_disputes (chain_id, reporter_id, accused_id)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_chain_disputes_chain ON public.chain_disputes (chain_id);

ALTER TABLE public.chain_disputes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chain_disputes FROM anon, authenticated;

-- ------------------------------------------------------------
-- Segnala un problema con UNO specifico degli altri partecipanti di una
-- catena completata. Pubblica il motivo in chain_messages (⚠️), visibile a
-- tutti e 3 nel thread di chat — stesso trattamento di
-- report_exchange_problem coi 1:1 (che pubblica in chat_messages, non
-- manda una notifica separata: stessa scelta qui, per coerenza).
-- ------------------------------------------------------------
CREATE FUNCTION public.report_chain_problem(p_chain_id uuid, p_accused_id uuid, p_reason text)
RETURNS public.chain_disputes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_chain public.chain_proposals;
  v_me uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_dispute public.chain_disputes;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if v_me = p_accused_id then raise exception 'Cannot report yourself'; end if;
  if v_reason is null then raise exception 'Reason is required'; end if;

  select * into v_chain from public.chain_proposals where id = p_chain_id;
  if not found then raise exception 'Chain not found'; end if;
  if v_chain.status <> 'completed' then
    raise exception 'Only completed chains can be reported';
  end if;

  if not exists (select 1 from public.chain_participants where chain_id = p_chain_id and user_id = v_me) then
    raise exception 'Not a participant of this chain';
  end if;
  if not exists (select 1 from public.chain_participants where chain_id = p_chain_id and user_id = p_accused_id) then
    raise exception 'Accused user is not a participant of this chain';
  end if;

  insert into public.chain_disputes (chain_id, reporter_id, accused_id, reason)
  values (p_chain_id, v_me, p_accused_id, v_reason)
  returning * into v_dispute;

  insert into public.chain_messages (chain_id, sender_id, body)
  values (p_chain_id, v_me, '⚠️ ' || v_reason);

  return v_dispute;
end $$;

GRANT EXECUTE ON FUNCTION public.report_chain_problem(uuid, uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- Risoluzione (azione amministrativa, stesso principio di
-- resolve_exchange_dispute — protetta da requireAdminSecret lato server,
-- MAI esposta al client mobile): qui non c'è nulla da annullare (la
-- catena è già 'completed', le transazioni già registrate), quindi si
-- limita a chiudere la segnalazione con un esito informativo e a
-- pubblicarlo in chat, visibile a tutti e 3.
-- ------------------------------------------------------------
CREATE FUNCTION public.resolve_chain_dispute(
  p_dispute_id uuid,
  p_outcome text,
  p_note text DEFAULT NULL
) RETURNS public.chain_disputes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_dispute public.chain_disputes;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_outcome not in ('upheld', 'dismissed') then
    raise exception 'Invalid outcome: %', p_outcome;
  end if;

  select * into v_dispute from public.chain_disputes where id = p_dispute_id for update;
  if not found then raise exception 'Dispute not found'; end if;
  if v_dispute.resolved_at is not null then
    raise exception 'Dispute already resolved';
  end if;

  update public.chain_disputes
     set resolved_at = now(), resolution = p_outcome, resolution_note = v_note
   where id = p_dispute_id
  returning * into v_dispute;

  insert into public.chain_messages (chain_id, sender_id, body)
  values (
    v_dispute.chain_id,
    v_dispute.reporter_id,
    case when p_outcome = 'upheld' then '✅ Segnalazione esaminata: confermata.'
         else '✅ Segnalazione esaminata: archiviata, nessun problema riscontrato.' end
    || coalesce(' ' || v_note, '')
  );

  return v_dispute;
end $$;

REVOKE ALL ON FUNCTION public.resolve_chain_dispute(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_chain_dispute(uuid, text, text) TO service_role;
