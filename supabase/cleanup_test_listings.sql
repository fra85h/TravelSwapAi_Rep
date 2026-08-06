-- ============================================================
-- Pulizia dei dati di test — ripartenza da zero.
--
-- NON è una migration: è uno script una tantum, e non sta in
-- supabase/migrations/ proprio perché non deve rigirare mai più.
--
-- Contesto: l'app non è ancora in produzione, i 333 annunci (e tutto
-- quello che ci gira attorno: proposte, match, chat, catene, punteggi
-- di affidabilità) sono dati di prova. Quindi non serve un criterio per
-- distinguere il vero dal finto: si svuota il contenuto e si tengono
-- SOLO gli account.
--
-- Cosa NON tocca:
--   • auth.users e profiles  -> gli account restano, puoi rientrare
--   • push_tokens, fb_account_links -> restano i collegamenti push/Messenger
--   • i file già caricati nel bucket Storage delle foto. Le RIGHE di
--     listing_images spariscono, i file no: SQL non arriva allo Storage.
--     Vanno svuotati dal pannello Supabase > Storage, se ti interessa
--     (sono pochi MB, puoi anche lasciarli lì).
--
-- Esegui un passo alla volta, selezionando il blocco e premendo Run.
-- ============================================================


-- ------------------------------------------------------------
-- PASSO 0 — Quali tabelle esistono davvero.
--
-- Non tutte le migration sono state applicate a mano, quindi qualche
-- tabella prevista dal repo può mancare dal database. Questa query te lo
-- dice invece di fartelo scoprire con un errore a metà cancellazione.
--
-- Le righe che tornano qui sono migration da eseguire, non un problema
-- della pulizia: il passo 2 salta da solo quello che non c'è.
-- ------------------------------------------------------------
SELECT t AS tabella_mancante
FROM unnest(ARRAY[
  'listings','listing_images','listing_secrets','listing_translations',
  'listing_ai_scores','listing_pings','listing_questions',
  'offers','chat_messages','matches','match_snapshots',
  'transactions','transaction_ratings',
  'chain_proposals','chain_participants','chain_messages','chain_disputes',
  'saved_listings','saved_searches','saved_search_matches',
  'notifications','trust_audit','ai_import_logs',
  'reports','report_action_tokens','payment_declarations'
]) AS t
WHERE to_regclass('public.' || t) IS NULL;


-- ------------------------------------------------------------
-- PASSO 1 — Cosa c'è adesso.
--
-- Serve come "prima" da confrontare col "dopo" del passo 3.
-- ------------------------------------------------------------
SELECT 'listings'          AS tabella, count(*) FROM public.listings
UNION ALL SELECT 'offers',            count(*) FROM public.offers
UNION ALL SELECT 'matches',           count(*) FROM public.matches
UNION ALL SELECT 'chat_messages',     count(*) FROM public.chat_messages
UNION ALL SELECT 'notifications',     count(*) FROM public.notifications
UNION ALL SELECT 'chain_proposals',   count(*) FROM public.chain_proposals
UNION ALL SELECT 'trust_audit',       count(*) FROM public.trust_audit
UNION ALL SELECT 'profiles (RESTA)',  count(*) FROM public.profiles
ORDER BY 2 DESC;


-- ------------------------------------------------------------
-- PASSO 2 — La cancellazione.
--
-- Dentro una transazione esplicita: finché non scrivi COMMIT non è
-- successo niente davvero, e ROLLBACK riporta tutto com'era.
--
-- TRUNCATE invece di DELETE perché è molto più veloce su queste
-- dimensioni e non fa scattare i trigger riga-per-riga (niente
-- notifiche generate mentre stai cancellando). CASCADE copre eventuali
-- tabelle collegate che dovessero sfuggire all'elenco.
--
-- L'elenco è costruito a runtime saltando le tabelle che non esistono:
-- un TRUNCATE scritto a mano fallisce tutto per una tabella sola che
-- manca, e con le migration applicate a mano succede davvero.
-- ------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  t         text;
  presenti  text[] := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'listings','listing_images','listing_secrets','listing_translations',
    'listing_ai_scores','listing_pings','listing_questions',
    'offers','chat_messages','matches','match_snapshots',
    'transactions','transaction_ratings',
    'chain_proposals','chain_participants','chain_messages','chain_disputes',
    'saved_listings','saved_searches','saved_search_matches',
    'notifications','trust_audit','ai_import_logs',
    'reports','report_action_tokens','payment_declarations'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      presenti := presenti || ('public.' || t);
    END IF;
  END LOOP;

  RAISE NOTICE 'Svuoto % tabelle: %', array_length(presenti, 1),
                                      array_to_string(presenti, ', ');
  EXECUTE 'TRUNCATE ' || array_to_string(presenti, ', ') || ' CASCADE';
END $$;

-- Se il messaggio di ritorno è "Success", scrivi COMMIT.
-- Se qualcosa ti torna storto, ROLLBACK e non è successo niente.

-- COMMIT;
-- ROLLBACK;


-- ------------------------------------------------------------
-- PASSO 3 — Verifica.
--
-- Tutti zero tranne profiles, che deve essere rimasto uguale al passo 1.
-- ------------------------------------------------------------
SELECT 'listings'          AS tabella, count(*) FROM public.listings
UNION ALL SELECT 'offers',            count(*) FROM public.offers
UNION ALL SELECT 'matches',           count(*) FROM public.matches
UNION ALL SELECT 'chat_messages',     count(*) FROM public.chat_messages
UNION ALL SELECT 'notifications',     count(*) FROM public.notifications
UNION ALL SELECT 'chain_proposals',   count(*) FROM public.chain_proposals
UNION ALL SELECT 'trust_audit',       count(*) FROM public.trust_audit
UNION ALL SELECT 'profiles (RESTA)',  count(*) FROM public.profiles
ORDER BY 2 DESC;

-- Dopo il COMMIT il cron delle catene, al giro successivo, non trova più
-- niente da valutare e chiude in pochi millisecondi a costo zero: è il
-- modo più rapido per confermare che il database è davvero pulito.


-- ============================================================
-- ALTERNATIVA — se un giorno servisse cancellare solo una parte.
--
-- Il TRUNCATE qui sopra vale perché OGGI non c'è niente di vero. Quando
-- ci saranno dati reali non si usa più: si cancella per criterio, e si
-- guarda prima cosa si sta per cancellare.
--
--   -- chi ha creato cosa
--   SELECT l.user_id, u.email, count(*) AS annunci
--   FROM public.listings l
--   LEFT JOIN auth.users u ON u.id = l.user_id
--   GROUP BY l.user_id, u.email
--   ORDER BY annunci DESC;
--
--   -- guarda le righe, POI cancellale con lo STESSO criterio
--   SELECT id, title, status, created_at FROM public.listings
--   WHERE user_id = '...';
--
--   BEGIN;
--   DELETE FROM public.listings WHERE user_id = '...';
--   -- il numero di righe combacia? COMMIT; altrimenti ROLLBACK;
--
-- La DELETE su listings porta con sé in cascata offerte, match, foto,
-- chat e partecipazioni alle catene (tutte le FK sono ON DELETE CASCADE;
-- l'unica eccezione è ai_import_logs, dove il riferimento va a NULL).
-- Restano invece le notifiche, che l'annuncio lo citano solo dentro un
-- campo jsonb senza vincolo: quelle vanno tolte a mano.
-- ============================================================
