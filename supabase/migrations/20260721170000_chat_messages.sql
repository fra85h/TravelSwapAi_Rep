-- Chat tra le due parti di una proposta ACCETTATA (acquisto o scambio).
-- Regole di prodotto:
--  - la chat esiste SOLO dopo l'accettazione (mai su pending: il campo
--    "message" della proposta copre già il pre-accordo; una chat libera
--    faciliterebbe spam e accordi fuori piattaforma);
--  - una chat per offerta (chat_id = offers.id, nessuna tabella "chats"
--    separata), tra proposer e proprietario dell'annuncio target;
--  - resta aperta anche a scambio concluso (assistenza post-scambio);
--  - scambi a 3 (catene) esclusi per ora.
-- Confronti sullo status: sempre ::text (trabocchetto enum, vedi CLAUDE.md).

CREATE TABLE public.chat_messages (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
  offer_id bigint NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  read_at timestamp with time zone,
  CONSTRAINT chat_messages_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000)
);

CREATE INDEX idx_chat_messages_offer_created
  ON public.chat_messages USING btree (offer_id, created_at);
-- per il conteggio non letti
CREATE INDEX idx_chat_messages_unread
  ON public.chat_messages USING btree (offer_id) WHERE (read_at IS NULL);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Parte della chat = proposer dell'offerta O proprietario dell'annuncio
-- target; l'offerta deve essere accettata (o finalizzata).
CREATE POLICY chat_messages_select ON public.chat_messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.offers o
    JOIN public.listings tl ON tl.id = o.to_listing_id
    WHERE o.id = chat_messages.offer_id
      AND o.status::text IN ('accepted', 'finalized')
      AND (o.proposer_id = auth.uid() OR tl.user_id = auth.uid())
  )
);

CREATE POLICY chat_messages_insert ON public.chat_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.offers o
    JOIN public.listings tl ON tl.id = o.to_listing_id
    WHERE o.id = chat_messages.offer_id
      AND o.status::text IN ('accepted', 'finalized')
      AND (o.proposer_id = auth.uid() OR tl.user_id = auth.uid())
  )
);
-- Nessuna policy UPDATE/DELETE: i messaggi sono immutabili dal client; il
-- solo read_at si aggiorna via RPC dedicata (sotto).

-- Segna come letti i messaggi dell'ALTRA parte in una mia chat. SECURITY
-- DEFINER perché non esiste una policy UPDATE (scelta voluta: il client non
-- deve poter toccare i messaggi); il filtro dentro la funzione fa da guardia.
CREATE FUNCTION public.mark_chat_read(offer_id_text text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.chat_messages m
     SET read_at = now()
   WHERE m.offer_id = offer_id_text::bigint
     AND m.read_at IS NULL
     AND m.sender_id <> auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.offers o
       JOIN public.listings tl ON tl.id = o.to_listing_id
       WHERE o.id = m.offer_id
         AND (o.proposer_id = auth.uid() OR tl.user_id = auth.uid())
     );
$$;
GRANT EXECUTE ON FUNCTION public.mark_chat_read(text) TO authenticated;

-- Elenco delle mie chat (offerte accettate/finalizzate di cui sono parte),
-- con ultimo messaggio e conteggio non letti — alimenta la sezione Chat in
-- Attività e il numeretto sul tab.
CREATE FUNCTION public.list_my_chats()
RETURNS TABLE(
  offer_id text, type text, status text,
  to_listing_id text, to_listing_title text, from_listing_title text,
  last_body text, last_at timestamp with time zone,
  unread_count integer, updated_at timestamp with time zone
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id::text,
    o.type,
    o.status::text,
    tl.id::text,
    tl.title,
    fl.title,
    lm.body,
    lm.created_at,
    COALESCE((
      SELECT count(*) FROM public.chat_messages m2
      WHERE m2.offer_id = o.id AND m2.read_at IS NULL AND m2.sender_id <> auth.uid()
    ), 0)::int,
    o.updated_at
  FROM public.offers o
  JOIN public.listings tl ON tl.id = o.to_listing_id
  LEFT JOIN public.listings fl ON fl.id = o.from_listing_id
  LEFT JOIN LATERAL (
    SELECT m.body, m.created_at
    FROM public.chat_messages m
    WHERE m.offer_id = o.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) lm ON true
  WHERE o.status::text IN ('accepted', 'finalized')
    AND (o.proposer_id = auth.uid() OR tl.user_id = auth.uid())
  ORDER BY COALESCE(lm.created_at, o.updated_at) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_chats() TO authenticated;

-- Realtime: i nuovi messaggi arrivano in push al client (postgres_changes,
-- filtrati dalla RLS di SELECT qui sopra).
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
