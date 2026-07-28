-- ============================================================
-- Valutazioni 1–5 stelle a transazione conclusa.
--
-- Regole di prodotto:
--  - si vota SOLO una transazione FINALIZED, e solo se ci hai preso parte
--    (proposer o proprietario dell'annuncio target): lo garantisce la RPC,
--    non l'interfaccia;
--  - un voto per parte per transazione (UNIQUE), immutabile: niente voti
--    ripetuti per gonfiare o affossare una reputazione;
--  - SOLO stelle, nessun testo: coerente con le domande a risposta chiusa —
--    niente da moderare, niente insulti, niente recapiti;
--  - DOUBLE-BLIND: un voto resta nascosto finché anche l'altra parte non ha
--    votato, o finché non passano 14 giorni. Toglie la ritorsione ("ti do 1
--    stella se non..."): quando voti non sai cosa ha messo l'altro, e il tuo
--    voto non gli arriva in tempo per "rispondere". La regola vive QUI, in
--    SQL: get_user_rating conta solo i voti rivelati, quindi nessun client
--    può leggere i voti freschi dell'altra parte;
--  - il retroattivo non esiste: si vota dalla transazione in poi, lo storico
--    di test verrà eliminato.
--
-- Nessun accesso diretto alla tabella (REVOKE): come listing_questions, ciò
-- che si può leggere è definito dalle funzioni. In particolare il voto del
-- singolo NON è mai esposto a terzi: fuori esce solo l'aggregato.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transaction_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    bigint NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  rater_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rated_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stars       int  NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT transaction_ratings_unique UNIQUE (offer_id, rater_id),
  CONSTRAINT transaction_ratings_stars CHECK (stars BETWEEN 1 AND 5),
  -- autovalutarsi non ha senso e non deve poter succedere nemmeno per bug
  CONSTRAINT transaction_ratings_not_self CHECK (rater_id <> rated_id)
);

CREATE INDEX IF NOT EXISTS ix_transaction_ratings_rated
  ON public.transaction_ratings (rated_id, created_at);

ALTER TABLE public.transaction_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_ratings FROM anon, authenticated;

-- ------------------------------------------------------------
-- Votare. Idempotente: il secondo tocco sullo stesso voto restituisce il
-- voto esistente invece di un errore; un voto DIVERSO dal primo viene
-- rifiutato (immutabile).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rate_transaction(p_offer_id bigint, p_stars int)
RETURNS TABLE(offer_id bigint, stars int, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_offer public.offers;
  v_owner uuid;
  v_me uuid := auth.uid();
  v_rated uuid;
  v_existing public.transaction_ratings;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'Stars must be between 1 and 5';
  end if;

  select * into v_offer from public.offers o where o.id = p_offer_id;
  if not found then raise exception 'Offer not found'; end if;
  if v_offer.status::text <> 'finalized' then
    raise exception 'Only completed transactions can be rated';
  end if;

  select l.user_id into v_owner from public.listings l where l.id = v_offer.to_listing_id;

  if v_me = v_offer.proposer_id then
    v_rated := v_owner;
  elsif v_me = v_owner then
    v_rated := v_offer.proposer_id;
  else
    raise exception 'Not a participant of this transaction';
  end if;
  if v_rated is null then raise exception 'Counterparty not found'; end if;

  select * into v_existing
  from public.transaction_ratings r
  where r.offer_id = p_offer_id and r.rater_id = v_me;

  if found then
    if v_existing.stars <> p_stars then
      raise exception 'Rating already given and cannot be changed';
    end if;
    return query select v_existing.offer_id, v_existing.stars, v_existing.created_at;
    return;
  end if;

  return query
  insert into public.transaction_ratings (offer_id, rater_id, rated_id, stars)
  values (p_offer_id, v_me, v_rated, p_stars)
  returning transaction_ratings.offer_id, transaction_ratings.stars, transaction_ratings.created_at;
end $$;

GRANT EXECUTE ON FUNCTION public.rate_transaction(bigint, int) TO authenticated;

-- ------------------------------------------------------------
-- L'aggregato pubblico di un utente: SOLO voti rivelati.
-- Rivelato = anche l'altra parte ha votato quella transazione, oppure sono
-- passati 14 giorni. È l'unica lettura esposta: i voti singoli non escono.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_rating(p_user_id uuid)
RETURNS TABLE(avg_stars numeric, ratings_count int)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT round(avg(r.stars)::numeric, 2) AS avg_stars,
         count(*)::int AS ratings_count
  FROM public.transaction_ratings r
  WHERE r.rated_id = p_user_id
    AND (
      EXISTS (
        SELECT 1 FROM public.transaction_ratings r2
        WHERE r2.offer_id = r.offer_id AND r2.rater_id <> r.rater_id
      )
      OR r.created_at < now() - interval '14 days'
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_user_rating(uuid) TO anon, authenticated;

-- ------------------------------------------------------------
-- Il MIO voto su una transazione (per sapere se mostrare le stelle in chat).
-- Solo il proprio: quello dell'altra parte resta dietro il double-blind.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_rating_for_offer(p_offer_id bigint)
RETURNS int
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.stars FROM public.transaction_ratings r
  WHERE r.offer_id = p_offer_id AND r.rater_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.my_rating_for_offer(bigint) TO authenticated;
