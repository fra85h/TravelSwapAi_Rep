-- ============================================================
-- Collegamento account TravelSwapAI <-> Messenger della Pagina
-- Facebook, per l'import annunci via bot (server/src/index.js,
-- flusso Messenger già esistente).
--
-- Problema che risolve: oggi ogni annuncio pubblicato dal bot
-- Messenger finisce sotto un unico account fisso
-- (DEFAULT_LISTING_OWNER_ID), perché non c'è modo di sapere a quale
-- account TravelSwapAI corrisponda chi sta scrivendo su Messenger.
--
-- Soluzione: un codice di collegamento monouso.
--  1. L'utente, loggato nell'app, genera un codice (fb_link_codes) —
--     endpoint autenticato, come /ai/parse-description.
--  2. Lo scrive al bot Messenger della Pagina.
--  3. Il bot lo riconosce (prima di trattarlo come testo di un
--     annuncio), verifica che sia valido e non scaduto, e crea la
--     riga permanente in fb_account_links.
--  4. Da quel momento, gli annunci di quel sender_id vengono
--     pubblicati sotto il suo vero user_id (non più il default).
--
-- Entrambe le tabelle sono a uso esclusivo del server (stesso
-- pattern di fb_sessions: RLS abilitata, nessuna policy, revoca
-- esplicita da anon/authenticated) — il client mobile non le tocca
-- mai direttamente, passa sempre dall'endpoint autenticato.
-- ============================================================

CREATE TABLE public.fb_link_codes (
    code text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    CONSTRAINT fb_link_codes_pkey PRIMARY KEY (code),
    CONSTRAINT fb_link_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX fb_link_codes_user_id_idx ON public.fb_link_codes USING btree (user_id);

CREATE TABLE public.fb_account_links (
    sender_id text NOT NULL,
    user_id uuid NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fb_account_links_pkey PRIMARY KEY (sender_id),
    CONSTRAINT fb_account_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX fb_account_links_user_id_idx ON public.fb_account_links USING btree (user_id);

alter table public.fb_link_codes enable row level security;
alter table public.fb_account_links enable row level security;

revoke all on table public.fb_link_codes from anon, authenticated;
revoke all on table public.fb_account_links from anon, authenticated;
