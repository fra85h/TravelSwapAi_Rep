-- ============================================================
-- Chat tra i 3 partecipanti di uno swap a catena COMPLETATO.
--
-- Bug reale: uno swap a 3 concluso non aveva NESSUN modo per i 3
-- partecipanti di accordarsi sulla consegna (dove/come scambiarsi i
-- biglietti, cambio nominativo, ecc.). La chat 1:1 (chat_messages) è
-- agganciata a offers.id, ma uno swap a catena non ha nessuna riga in
-- `offers` — vive solo in chain_proposals/chain_participants — quindi non
-- può riusare la stessa tabella. Stessa struttura, tabella parallela.
--
-- Si apre SOLO a catena 'completed' (mai su 'proposed'): a differenza del
-- 2 lati, qui non esiste uno stato "accettato ma non ancora chiuso" — la
-- catena diventa 'completed' atomicamente quando tutti e 3 confermano
-- (vedi confirm_chain_participant, 20260718100000), quindi non c'è nulla
-- da negoziare prima di quel momento: aprire la chat prima rischierebbe di
-- far scambiare contatti per un giro che potrebbe ancora decadere.
-- Confronti sullo status: chain_proposals.status è `text`, non un enum
-- (vedi 20260712120000_swap_chains.sql) — nessun cast necessario.
-- ============================================================

CREATE TABLE public.chain_messages (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
  chain_id uuid NOT NULL REFERENCES public.chain_proposals(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  read_at timestamp with time zone,
  CONSTRAINT chain_messages_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000)
);

CREATE INDEX idx_chain_messages_chain_created
  ON public.chain_messages USING btree (chain_id, created_at);
-- per il conteggio non letti
CREATE INDEX idx_chain_messages_unread
  ON public.chain_messages USING btree (chain_id) WHERE (read_at IS NULL);

ALTER TABLE public.chain_messages ENABLE ROW LEVEL SECURITY;

-- Parte della chat = uno dei 3 partecipanti della catena (riusa l'helper
-- SECURITY DEFINER già esistente per evitare la ricorsione RLS, vedi
-- _chain_participant_exists in 20260712120000_swap_chains.sql), e la
-- catena deve essere completata.
CREATE POLICY chain_messages_select ON public.chain_messages FOR SELECT USING (
  public._chain_participant_exists(chain_id, auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.chain_proposals cp
    WHERE cp.id = chain_messages.chain_id AND cp.status = 'completed'
  )
);

CREATE POLICY chain_messages_insert ON public.chain_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND public._chain_participant_exists(chain_id, auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.chain_proposals cp
    WHERE cp.id = chain_messages.chain_id AND cp.status = 'completed'
  )
);
-- Nessuna policy UPDATE/DELETE: messaggi immutabili dal client, come
-- chat_messages; il solo read_at si aggiorna via RPC dedicata sotto.

-- Segna come letti i messaggi degli ALTRI 2 partecipanti nella mia chat di
-- catena. SECURITY DEFINER: niente policy UPDATE lato client per design.
CREATE FUNCTION public.mark_chain_chat_read(p_chain_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.chain_messages m
     SET read_at = now()
   WHERE m.chain_id = p_chain_id
     AND m.read_at IS NULL
     AND m.sender_id <> auth.uid()
     AND public._chain_participant_exists(m.chain_id, auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.mark_chain_chat_read(uuid) TO authenticated;

-- Elenco delle mie chat di catena (swap a 3 completati di cui sono parte),
-- con ultimo messaggio e non letti — alimenta la sezione Chat in Attività
-- insieme a list_my_chats() (le due liste si uniscono lato client).
CREATE FUNCTION public.list_my_chain_chats()
RETURNS TABLE(
  chain_id text, completed_at timestamp with time zone,
  my_give_title text, my_receive_title text,
  last_body text, last_at timestamp with time zone,
  unread_count integer, updated_at timestamp with time zone
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cp.id::text,
    cp.completed_at,
    gl.title,
    rl.title,
    lm.body,
    lm.created_at,
    COALESCE((
      SELECT count(*) FROM public.chain_messages m2
      WHERE m2.chain_id = cp.id AND m2.read_at IS NULL AND m2.sender_id <> auth.uid()
    ), 0)::int,
    COALESCE(lm.created_at, cp.completed_at)
  FROM public.chain_proposals cp
  JOIN public.chain_participants me ON me.chain_id = cp.id AND me.user_id = auth.uid()
  JOIN public.listings gl ON gl.id = me.give_listing_id
  JOIN public.listings rl ON rl.id = me.receive_listing_id
  LEFT JOIN LATERAL (
    SELECT m.body, m.created_at FROM public.chain_messages m
    WHERE m.chain_id = cp.id ORDER BY m.created_at DESC LIMIT 1
  ) lm ON true
  WHERE cp.status = 'completed'
  ORDER BY COALESCE(lm.created_at, cp.completed_at) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_chain_chats() TO authenticated;

-- Realtime: i nuovi messaggi arrivano in push (filtrati dalla RLS sopra).
ALTER PUBLICATION supabase_realtime ADD TABLE public.chain_messages;
