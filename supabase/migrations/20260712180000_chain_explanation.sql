-- ============================================================
-- Swap a catena, fase 3: spiegazione in linguaggio naturale.
--
-- Aggiunge solo la colonna dove il server salva la spiegazione generata
-- (AI, con fallback a un testo strutturato deterministico) subito dopo
-- aver creato la proposta — vedi server/src/ai/chainExplain.js e
-- server/src/models/chains.js. Scrittura da service_role (bypassa la
-- RLS già attiva sulla tabella, nessuna policy aggiuntiva necessaria).
-- ============================================================

ALTER TABLE public.chain_proposals ADD COLUMN IF NOT EXISTS explanation text;
