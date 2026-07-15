-- ============================================================
-- TravelSwapAI — Segnalazioni (report annunci/utenti)
-- Da eseguire UNA volta nel SQL Editor del progetto Supabase.
--
-- Permette a un utente di segnalare un annuncio o un venditore sospetto.
-- Ogni riga appartiene a UN reporter: policy RLS dirette. Le segnalazioni
-- si INSERISCONO e si LEGGONO solo dal proprio autore; la moderazione
-- (lettura di tutte le segnalazioni, cambio stato) avviene via service_role
-- lato server/dashboard, che bypassa la RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reports (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    reporter_id uuid NOT NULL,
    listing_id uuid,
    reported_user_id uuid,
    reason text NOT NULL,
    details text,
    status text DEFAULT 'open' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reports_pkey PRIMARY KEY (id),
    CONSTRAINT reports_reason_check CHECK (reason = ANY (ARRAY[
      'fake'::text, 'scam'::text, 'inappropriate'::text, 'duplicate'::text, 'other'::text
    ])),
    CONSTRAINT reports_status_check CHECK (status = ANY (ARRAY[
      'open'::text, 'reviewing'::text, 'resolved'::text, 'dismissed'::text
    ])),
    CONSTRAINT reports_reporter_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT reports_listing_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE,
    CONSTRAINT reports_reported_user_fkey FOREIGN KEY (reported_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter ON public.reports USING btree (reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_listing ON public.reports USING btree (listing_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports USING btree (status) WHERE status = 'open';

-- Evita segnalazioni duplicate dello stesso annuncio dallo stesso utente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_reporter_listing
  ON public.reports (reporter_id, listing_id) WHERE listing_id IS NOT NULL;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Un utente autenticato può creare una segnalazione a proprio nome.
DROP POLICY IF EXISTS reports_insert_own ON public.reports;
CREATE POLICY reports_insert_own ON public.reports
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);

-- Un utente può rileggere solo le segnalazioni che ha inviato.
DROP POLICY IF EXISTS reports_select_own ON public.reports;
CREATE POLICY reports_select_own ON public.reports
    FOR SELECT TO authenticated USING (auth.uid() = reporter_id);
