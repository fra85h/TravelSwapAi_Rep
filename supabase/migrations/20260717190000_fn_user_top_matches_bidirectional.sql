-- ============================================================
-- fn_user_top_matches: esporre anche bidirectional.
--
-- La funzione non restituiva la colonna matches.bidirectional, quindi il
-- chiamante (recomputeUserSnapshotSQL in server/src/models/matches.js)
-- doveva ricostruirla con un proxy grezzo (score >= 80) invece di usare il
-- valore reale calcolato dal matcher (complementarità CERCO/VENDO strutturale
-- o scambio reciproco reale) — due definizioni diverse di "reciproco" nello
-- stesso dominio. Qui si allinea la funzione allo schema per esporre il dato
-- vero.
-- ============================================================

-- CREATE OR REPLACE non basta: cambia il tipo di ritorno (nuova colonna OUT
-- "bidirectional"), e Postgres rifiuta con 42P13 "cannot change return type
-- of existing function" se non si fa DROP prima.
DROP FUNCTION IF EXISTS public.fn_user_top_matches(uuid, integer);

CREATE FUNCTION public.fn_user_top_matches(p_user_id uuid, p_top_per_listing integer DEFAULT 3)
RETURNS TABLE(
  from_listing_id uuid,
  to_listing_id uuid,
  score integer,
  title text,
  type text,
  location text,
  price numeric,
  explanation text,
  model text,
  bidirectional boolean,
  updated_at timestamp with time zone
)
    LANGUAGE sql STABLE
    AS $$
  with ranked as (
    select
      m.*,
      row_number() over (partition by m.from_listing_id order by m.score desc) as rn
    from public.matches m
    join public.listings lf on lf.id = m.from_listing_id
    where lf.user_id = p_user_id
  )
  select
    r.from_listing_id,
    r.to_listing_id,
    r.score,
    lt.title,
    lt.type,
    lt.location,
    lt.price,
    r.explanation,
    r.model,
    r.bidirectional,
    r.updated_at
  from ranked r
  join public.listings lt on lt.id = r.to_listing_id and lt.status = 'active'
  where r.rn <= p_top_per_listing;
$$;
