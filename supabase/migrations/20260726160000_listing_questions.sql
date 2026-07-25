-- ============================================================
-- Domande sull'annuncio, prima di qualsiasi proposta.
--
-- Il problema: la chat esiste solo dopo l'accettazione (vedi
-- 20260721170000_chat_messages.sql, dove la regola è motivata), quindi non
-- c'era modo di chiedere niente prima di espporsi con una proposta. Peggio:
-- su un biglietto nominativo l'app mostra "⚠️ potrebbe servire il cambio
-- nominativo — verifica con il venditore" e poi non offre nessun modo per
-- verificare. Diceva di fare una cosa che non lasciava fare.
--
-- Perché non una chat libera. La motivazione della regola originale resta
-- valida: una chat aperta prima dell'accettazione facilita spam e accordi
-- fuori piattaforma. Qui il canale è a RISPOSTA CHIUSA — un elenco fisso di
-- domande, un elenco fisso di risposte, zero testo libero. Senza campo libero
-- non ci sono recapiti da intercettare, non serve moderare (che costerebbe una
-- chiamata AI per messaggio, sullo stesso budget che oggi dà 429 durante i
-- Check AI) e non ci sono falsi positivi su testo innocente: in questa app si
-- scrivono di continuo numeri di treno, orari e PNR, che a un filtro
-- anti-contatti somigliano molto a recapiti.
--
-- Le risposte sono PUBBLICHE sull'annuncio, non un messaggio privato: il
-- venditore risponde una volta e la legge chiunque, così il volume di domande
-- scende invece di crescere. Nessuna domanda è personale — sono tutte
-- proprietà del biglietto.
--
-- Il catalogo dei codici vive in travelswap_ai/travelswapai/lib/
-- listingQuestions.mjs ed è validato lì dal server: qui non si duplica, per
-- non avere due elenchi che divergono.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Classe del biglietto come CAMPO, non come domanda
--
-- "Prima o seconda classe" era una delle domande richieste, ma è un dato che
-- l'AI sa già estrarre dalla descrizione ("546 seconda classe") e che il Check
-- AI segnala come lacuna quando manca. Averlo come colonna significa che il
-- compratore non deve chiedere niente e la risposta vale per tutti; la domanda
-- resta solo come rete di sicurezza quando il campo è vuoto (showWhen nel
-- catalogo).
--
-- Testo libero e non enum: le denominazioni commerciali cambiano da operatore
-- a operatore (Business, Executive, Prima, Standard...) e un enum andrebbe
-- migrato ogni volta.
-- ------------------------------------------------------------
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS ticket_class text;

COMMENT ON COLUMN public.listings.ticket_class IS
  'Classe/tariffa del biglietto (prima, seconda, business...). Riempita dall''AI quando la trova nel testo; se resta vuota il compratore può chiederla.';


-- ------------------------------------------------------------
-- 2) Le domande
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.listing_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  asker_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code         text NOT NULL,
  answer       text,
  answered_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Antispam, stessa filosofia di listing_pings: una domanda per persona per
  -- annuncio. Senza, lo stesso utente potrebbe ripetere la stessa domanda
  -- all'infinito e generare una notifica ogni volta.
  CONSTRAINT listing_questions_unique UNIQUE (listing_id, asker_id, code),

  -- I codici sono corti e chiusi: qualunque cosa più lunga significa che
  -- qualcuno sta provando a infilare testo libero dove non deve esserci.
  CONSTRAINT listing_questions_code_len CHECK (char_length(btrim(code)) BETWEEN 2 AND 40),
  CONSTRAINT listing_questions_answer_len CHECK (answer IS NULL OR char_length(btrim(answer)) BETWEEN 2 AND 40),

  -- Una risposta senza data (o viceversa) è uno stato che non deve esistere.
  CONSTRAINT listing_questions_answer_consistency
    CHECK ((answer IS NULL AND answered_at IS NULL) OR (answer IS NOT NULL AND answered_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_listing_questions_listing
  ON public.listing_questions (listing_id, created_at DESC);

-- Per il pannello del venditore: le sue domande ancora senza risposta.
CREATE INDEX IF NOT EXISTS ix_listing_questions_unanswered
  ON public.listing_questions (listing_id)
  WHERE answer IS NULL;

ALTER TABLE public.listing_questions ENABLE ROW LEVEL SECURITY;

-- Nessun accesso diretto dai ruoli pubblici: si passa dalle funzioni qui
-- sotto. Stessa scelta di listing_pings e delle tabelle server-only
-- (20260725120000): l'accesso è definito da cosa la funzione restituisce, non
-- da quali righe la tabella espone.
--
-- In particolare NESSUNO deve poter leggere asker_id: le risposte sono
-- pubbliche, ma chi ha fatto la domanda no. Le RLS filtrano le righe, non le
-- colonne, quindi l'unico modo per non esporre quella colonna è non dare
-- accesso alla tabella.
REVOKE ALL ON public.listing_questions FROM anon, authenticated;


-- ------------------------------------------------------------
-- 3) Lettura pubblica: domande e risposte SENZA l'identità di chi ha chiesto
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_listing_questions(p_listing_id uuid)
RETURNS TABLE(id uuid, code text, answer text, answered_at timestamptz, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.code, q.answer, q.answered_at, q.created_at
  FROM public.listing_questions q
  JOIN public.listings l ON l.id = q.listing_id
  WHERE q.listing_id = p_listing_id
    -- Su un annuncio non più visibile non si espone nulla, nemmeno lo storico.
    AND (l.status::text = 'active' OR l.user_id = auth.uid())
  ORDER BY q.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_listing_questions(uuid) TO anon, authenticated;


-- ------------------------------------------------------------
-- 4) Risposta: solo il proprietario dell'annuncio, e una volta sola
--
-- La validità del codice risposta è verificata lato server contro il catalogo
-- condiviso; qui si difende ciò che il catalogo non può sapere: chi sei e se
-- hai già risposto.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.answer_listing_question(p_question_id uuid, p_answer text)
RETURNS public.listing_questions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_row public.listing_questions;
  v_owner uuid;
begin
  select * into v_row from public.listing_questions where id = p_question_id for update;
  if not found then raise exception 'Question not found'; end if;

  select l.user_id into v_owner from public.listings l where l.id = v_row.listing_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  -- Già risposta: si restituisce com'è invece di sollevare un errore, così un
  -- doppio tocco sul pulsante non diventa un messaggio di errore all'utente.
  if v_row.answer is not null then
    return v_row;
  end if;

  update public.listing_questions
     set answer = btrim(p_answer), answered_at = now()
   where id = p_question_id
  returning * into v_row;

  return v_row;
end $$;

GRANT EXECUTE ON FUNCTION public.answer_listing_question(uuid, text) TO authenticated;


-- ------------------------------------------------------------
-- 5) Il pannello del venditore: le domande in attesa sui suoi annunci
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_pending_questions(max_rows int DEFAULT 50)
RETURNS TABLE(id uuid, listing_id uuid, listing_title text, code text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.listing_id, l.title, q.code, q.created_at
  FROM public.listing_questions q
  JOIN public.listings l ON l.id = q.listing_id
  WHERE l.user_id = auth.uid()
    AND q.answer IS NULL
    AND l.status::text NOT IN ('sold','swapped','exchanged','traded','deleted','archived')
  ORDER BY q.created_at ASC
  LIMIT greatest(1, least(coalesce(max_rows, 50), 200));
$$;

GRANT EXECUTE ON FUNCTION public.list_my_pending_questions(int) TO authenticated;


-- ------------------------------------------------------------
-- 6) Notifiche: due tipi nuovi
--
-- Il CHECK su notifications.type è un elenco chiuso e va esteso a mano ogni
-- volta (stesso passaggio fatto da 20260722150000 per 'listing_ping').
-- Ricostruito per intero: un ALTER che ne aggiunge uno solo perderebbe gli
-- altri.
-- ------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('offer_received','offer_accepted','offer_declined','new_matches',
                  'listing_ping','listing_question','listing_question_answered'));
