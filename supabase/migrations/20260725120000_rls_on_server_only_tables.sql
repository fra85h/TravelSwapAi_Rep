-- ============================================================
-- Difesa in profondità: RLS sulle tabelle finora scoperte.
--
-- Sei tabelle non avevano RLS abilitata: fb_link_codes, fb_account_links,
-- fb_sessions, trust_audit, match_snapshots, listing_ai_scores.
--
-- Oggi NON sono raggiungibili da PostgREST perché nessuna migration concede
-- privilegi su di esse ai ruoli `anon`/`authenticated`. Il punto è proprio
-- questo: la loro protezione dipende dall'ASSENZA di un GRANT, non da una
-- regola esplicita. Basta un `GRANT ... ON ALL TABLES IN SCHEMA public`
-- scritto per comodità — o una futura migration distratta — perché
-- diventino leggibili da chiunque abbia la chiave anon, che è pubblica e
-- viaggia dentro l'app.
--
-- Cosa contengono, per capire la posta in gioco:
--   fb_link_codes     codici monouso che collegano un profilo Messenger a un
--                     account TravelSwapAI: leggerli significa dirottare il
--                     collegamento di un altro utente
--   fb_account_links  la corrispondenza sender Messenger <-> user_id
--   fb_sessions       la bozza di annuncio in corso di compilazione via bot
--   trust_audit       lo storico completo dei Check AI (flag, punteggi, raw)
--   match_snapshots   i suggerimenti "Per te" di ogni utente
--   listing_ai_scores i punteggi AI per annuncio
--
-- Con RLS abilitata e NESSUNA policy, l'accesso via chiave anon/authenticated
-- è negato per definizione. Il server continua a funzionare identico: usa la
-- SERVICE_ROLE_KEY, che per progetto di Postgres BYPASSA le RLS (il ruolo ha
-- l'attributo BYPASSRLS). Nessun percorso dell'app legge queste tabelle
-- direttamente — verificato: passano tutte dal backend.
--
-- Non aggiungiamo policy permissive: sarebbe aprire una porta che oggi non
-- serve a nessuno. Se in futuro il client dovrà leggere, per esempio, i
-- propri trust_audit, si aggiungerà allora una policy mirata su user_id.
-- ============================================================

ALTER TABLE public.fb_link_codes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_account_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_audit        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_ai_scores  ENABLE ROW LEVEL SECURITY;

-- Revoca esplicita dei privilegi ai ruoli pubblici: la RLS filtra le RIGHE,
-- ma senza policy un eventuale GRANT futuro darebbe comunque accesso alla
-- tabella (zero righe, però visibile). Meglio che il permesso non ci sia
-- proprio, così le due difese sono indipendenti.
REVOKE ALL ON public.fb_link_codes      FROM anon, authenticated;
REVOKE ALL ON public.fb_account_links   FROM anon, authenticated;
REVOKE ALL ON public.fb_sessions        FROM anon, authenticated;
REVOKE ALL ON public.trust_audit        FROM anon, authenticated;
REVOKE ALL ON public.match_snapshots    FROM anon, authenticated;
REVOKE ALL ON public.listing_ai_scores  FROM anon, authenticated;

-- v_latest_trustscore legge trust_audit. Una view NON security_invoker gira
-- con i privilegi del proprietario, quindi continuerebbe a funzionare per
-- chiunque possa interrogarla: le si revoca l'accesso pubblico per coerenza
-- con la tabella sottostante (la usa solo il backend).
REVOKE ALL ON public.v_latest_trustscore FROM anon, authenticated;
