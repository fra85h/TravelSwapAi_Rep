-- ============================================================
-- Avvisi di ricerca (D3): "avvisami quando compare un treno
-- Roma->Milano sotto 40€".
--
-- Diverso dallo swap a catena: qui ogni riga appartiene interamente
-- a UN utente (nessuna coordinazione multi-utente), quindi bastano
-- policy RLS dirette owner-only — non serve nessuna funzione
-- SECURITY DEFINER né restrizione a service_role sulla scrittura.
--
-- La creazione annunci è interamente lato client (l'app scrive
-- direttamente su Supabase, il server non lo sa mai in tempo reale),
-- quindi il confronto avvisi<->annunci avviene con un job periodico
-- lato server (vedi server/src/models/savedSearches.js), non con un
-- trigger. Il matching è deterministico (filtro esplicito
-- dell'utente), non richiede AI.
-- ============================================================

CREATE TABLE public.saved_searches (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    type public.listing_type NOT NULL,
    cerco_vendo text DEFAULT 'VENDO'::text NOT NULL,
    route_from text,
    route_to text,
    location text,
    max_price numeric(10,2),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_searches_pkey PRIMARY KEY (id),
    CONSTRAINT saved_searches_cerco_vendo_check CHECK (cerco_vendo = ANY (ARRAY['CERCO'::text, 'VENDO'::text])),
    CONSTRAINT saved_searches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT saved_searches_max_price_check CHECK (max_price IS NULL OR max_price >= 0)
);

CREATE TABLE public.saved_search_matches (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    saved_search_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    matched_at timestamp with time zone DEFAULT now() NOT NULL,
    seen boolean DEFAULT false NOT NULL,
    CONSTRAINT saved_search_matches_pkey PRIMARY KEY (id),
    CONSTRAINT saved_search_matches_unique UNIQUE (saved_search_id, listing_id),
    CONSTRAINT saved_search_matches_search_fkey FOREIGN KEY (saved_search_id) REFERENCES public.saved_searches(id) ON DELETE CASCADE,
    CONSTRAINT saved_search_matches_listing_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE
);

CREATE INDEX idx_saved_searches_user ON public.saved_searches USING btree (user_id);
CREATE INDEX idx_saved_searches_active ON public.saved_searches USING btree (active) WHERE active;
CREATE INDEX idx_saved_search_matches_search ON public.saved_search_matches USING btree (saved_search_id);

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_search_matches ENABLE ROW LEVEL SECURITY;

-- saved_searches: il proprietario gestisce direttamente le proprie righe
-- (a differenza delle chain_proposals, qui non c'è nulla da validare
-- lato server: un utente può salvare/modificare/cancellare i propri
-- filtri liberamente).
CREATE POLICY saved_searches_owner_select ON public.saved_searches
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY saved_searches_owner_insert ON public.saved_searches
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY saved_searches_owner_update ON public.saved_searches
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY saved_searches_owner_delete ON public.saved_searches
    FOR DELETE USING (auth.uid() = user_id);

-- saved_search_matches: nessuna ricorsione qui (la subquery interroga
-- saved_searches, non se stessa) — niente serve una funzione helper
-- come per chain_participants. Le righe le scrive solo il job
-- periodico (service_role, bypassa la RLS); l'utente può solo leggerle
-- e segnarle come lette.
CREATE POLICY saved_search_matches_owner_select ON public.saved_search_matches
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.saved_searches ss
            WHERE ss.id = saved_search_matches.saved_search_id AND ss.user_id = auth.uid()
        )
    );
CREATE POLICY saved_search_matches_owner_update ON public.saved_search_matches
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.saved_searches ss
            WHERE ss.id = saved_search_matches.saved_search_id AND ss.user_id = auth.uid()
        )
    );
