-- ============================================================
-- Pulizia degli annunci di test — DA ESEGUIRE UN PASSO ALLA VOLTA.
--
-- NON è una migration: è uno script una tantum, e non va in
-- supabase/migrations/ proprio perché non deve rigirare mai più.
--
-- Perché è diviso in passi: nessuno qui sa quali righe siano di test.
-- Quel criterio ce l'hai solo tu, e una DELETE lanciata sul criterio
-- sbagliato non si annulla. I passi 1 e 2 servono a farti VEDERE cosa
-- stai per cancellare prima di cancellarlo.
--
-- Cosa succede alle tabelle collegate: tutto ciò che punta a listings ha
-- ON DELETE CASCADE (verificato: offers, matches, listing_images,
-- listing_secrets, listing_translations, saved_listings, transactions,
-- chain_participants, saved_search_matches, listing_questions, reports,
-- report_action_tokens). Cancellando un annuncio spariscono con lui le
-- sue proposte, i suoi match e le sue foto — che per dati di test è
-- esattamente quello che vuoi. L'unica eccezione è ai_import_logs, dove
-- il riferimento viene messo a NULL invece che cancellato.
-- ============================================================


-- ------------------------------------------------------------
-- PASSO 1 — Chi ha creato cosa.
--
-- Se gli annunci di test li hai fatti tutti con un account solo, qui lo
-- riconosci subito: sarà la riga con centinaia di annunci.
-- ------------------------------------------------------------
SELECT
  l.user_id,
  p.email,
  count(*)                                        AS annunci,
  count(*) FILTER (WHERE l.status = 'active')     AS attivi,
  min(l.created_at)::date                         AS primo,
  max(l.created_at)::date                         AS ultimo
FROM public.listings l
LEFT JOIN auth.users p ON p.id = l.user_id
GROUP BY l.user_id, p.email
ORDER BY annunci DESC;


-- ------------------------------------------------------------
-- PASSO 2 — Guarda cosa stai per cancellare, PRIMA di cancellarlo.
--
-- Sostituisci il criterio qui sotto con quello vero (l'utente trovato al
-- passo 1, o un intervallo di date, o quello che distingue i tuoi test).
-- Se il numero e i titoli non ti convincono, NON passare al passo 3.
-- ------------------------------------------------------------
SELECT id, title, status, type, created_at
FROM public.listings
WHERE user_id = 'INCOLLA-QUI-LO-USER-ID'   -- <<< dal passo 1
ORDER BY created_at DESC;

-- E il conteggio esatto, che è il numero da confrontare col risultato
-- della DELETE:
SELECT count(*) AS da_cancellare
FROM public.listings
WHERE user_id = 'INCOLLA-QUI-LO-USER-ID';


-- ------------------------------------------------------------
-- PASSO 3 — La cancellazione vera.
--
-- Dentro una transazione ESPLICITA: la DELETE mostra quante righe ha
-- toccato, e finché non scrivi COMMIT non è successo niente davvero. Se
-- il numero non combacia con quello del passo 2, scrivi ROLLBACK e
-- ricontrolla il criterio.
--
-- ⚠️ Il criterio deve essere IDENTICO a quello del passo 2. Cambiarlo fra
-- i due passi vanifica la verifica appena fatta.
-- ------------------------------------------------------------
BEGIN;

DELETE FROM public.listings
WHERE user_id = 'INCOLLA-QUI-LO-USER-ID';   -- <<< lo stesso del passo 2

-- Guarda quante righe dice di aver cancellato.
--   combacia   -> COMMIT;
--   non combacia -> ROLLBACK;

-- COMMIT;
-- ROLLBACK;


-- ------------------------------------------------------------
-- PASSO 4 — Verifica, e ripartenza pulita del cron catene.
-- ------------------------------------------------------------
SELECT
  count(*)                                    AS annunci_rimasti,
  count(*) FILTER (WHERE status = 'active')   AS attivi_rimasti
FROM public.listings;

-- Le proposte di catena costruite sugli annunci cancellati sono già
-- sparite in cascata, ma quelle che coinvolgevano SOLO utenti di test
-- possono essere rimaste senza partecipanti: si chiudono così.
UPDATE public.chain_proposals
   SET status = 'canceled'
 WHERE status = 'proposed'
   AND NOT EXISTS (
     SELECT 1 FROM public.chain_participants cp WHERE cp.chain_id = chain_proposals.id
   );
