-- ============================================================
-- TravelSwapAI — Token azione da email di segnalazione
--
-- Quando arriva una segnalazione (reports), l'email di notifica a chi
-- modera include due link "un click": metti in pausa / elimina
-- l'annuncio segnalato. Il click apre una pagina di conferma (GET, non
-- consuma il token) con un bottone che sottomette un form POST (che
-- consuma il token ed esegue l'azione) — separare GET da POST evita che
-- un client email o uno scanner che pre-carica i link esegua l'azione
-- da solo (rischio concreto con "elimina", che è terminale/irreversibile).
--
-- Stesso pattern di fb_link_codes (20260713040000): token come chiave
-- primaria, scadenza, consumo atomico via UPDATE ... WHERE used_at IS
-- NULL. Tabella a uso esclusivo del server (service_role): RLS abilitata,
-- nessuna policy, revoca esplicita da anon/authenticated — nessuna azione
-- di moderazione passa mai dal client con la sessione dell'utente.
-- ============================================================

CREATE TABLE public.report_action_tokens (
    token text NOT NULL,
    report_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    CONSTRAINT report_action_tokens_pkey PRIMARY KEY (token),
    CONSTRAINT report_action_tokens_action_check CHECK (action = ANY (ARRAY['pause'::text, 'delete'::text])),
    CONSTRAINT report_action_tokens_report_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE,
    CONSTRAINT report_action_tokens_listing_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE
);

CREATE INDEX report_action_tokens_report_id_idx ON public.report_action_tokens USING btree (report_id);

alter table public.report_action_tokens enable row level security;

revoke all on table public.report_action_tokens from anon, authenticated;
