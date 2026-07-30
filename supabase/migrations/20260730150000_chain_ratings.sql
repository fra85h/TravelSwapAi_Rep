-- ============================================================
-- Threat-modeling fase post-transazione (sezione A, punto 3, parte 1/2):
-- rate_transaction/get_user_rating (20260727120000_transaction_ratings.sql)
-- leggono SOLO da public.offers (select * into v_offer from public.offers
-- o where o.id = p_offer_id, richiede status='finalized'). Uno scambio a
-- catena completato non crea MAI una riga in offers (confirm_chain_participant
-- scrive solo in transactions), quindi non è mai valutabile: chi fa molti
-- scambi a 3 e nessuno 1:1 resta "Nuovo" a vita, indipendentemente dallo
-- storico reale.
--
-- Decisione presa con l'utente: 3 valutazioni indipendenti a coppia, stesso
-- doppio cieco già usato per i 1:1 (nascosto finché entrambi votano o
-- passano 14 giorni). In un ciclo a 3 (A dà a B, B dà a C, C dà ad A) OGNI
-- altro partecipante è automaticamente una controparte legittima — non
-- serve distinguere direzione dare/ricevere, bastano "sono un partecipante
-- della stessa catena" per rater e rated.
--
-- Riusa la STESSA tabella transaction_ratings (non una nuova), così
-- get_user_rating resta un aggregato UNICO su tutta la storia di un utente
-- (1:1 + catene): offer_id diventa nullable, chain_id si aggiunge, un CHECK
-- garantisce che sia valorizzato esattamente uno dei due.
-- ============================================================

ALTER TABLE public.transaction_ratings
  ALTER COLUMN offer_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS chain_id uuid REFERENCES public.chain_proposals(id) ON DELETE CASCADE;

ALTER TABLE public.transaction_ratings
  ADD CONSTRAINT transaction_ratings_exactly_one_target
  CHECK ((offer_id IS NOT NULL) <> (chain_id IS NOT NULL));

-- La UNIQUE esistente (offer_id, rater_id) non protegge i voti di catena
-- (offer_id sempre null lì): in una catena un rater ha DUE controparti
-- legittime, quindi rated_id entra nella chiave.
ALTER TABLE public.transaction_ratings
  ADD CONSTRAINT transaction_ratings_chain_unique UNIQUE (chain_id, rater_id, rated_id);

-- ------------------------------------------------------------
-- Votare un partecipante di una catena COMPLETATA. Stessa idempotenza di
-- rate_transaction: il secondo tocco sullo stesso voto lo ritorna invece di
-- errore, un voto diverso viene rifiutato (immutabile).
-- ------------------------------------------------------------
CREATE FUNCTION public.rate_chain_transaction(p_chain_id uuid, p_rated_id uuid, p_stars int)
RETURNS TABLE(chain_id uuid, rated_id uuid, stars int, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_chain public.chain_proposals;
  v_me uuid := auth.uid();
  v_existing public.transaction_ratings;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'Stars must be between 1 and 5';
  end if;
  if v_me = p_rated_id then raise exception 'Cannot rate yourself'; end if;

  select * into v_chain from public.chain_proposals where id = p_chain_id;
  if not found then raise exception 'Chain not found'; end if;
  if v_chain.status <> 'completed' then
    raise exception 'Only completed chains can be rated';
  end if;

  if not exists (select 1 from public.chain_participants where chain_id = p_chain_id and user_id = v_me) then
    raise exception 'Not a participant of this chain';
  end if;
  if not exists (select 1 from public.chain_participants where chain_id = p_chain_id and user_id = p_rated_id) then
    raise exception 'Rated user is not a participant of this chain';
  end if;

  select * into v_existing
  from public.transaction_ratings r
  where r.chain_id = p_chain_id and r.rater_id = v_me and r.rated_id = p_rated_id;

  if found then
    if v_existing.stars <> p_stars then
      raise exception 'Rating already given and cannot be changed';
    end if;
    return query select v_existing.chain_id, v_existing.rated_id, v_existing.stars, v_existing.created_at;
    return;
  end if;

  return query
  insert into public.transaction_ratings (chain_id, rater_id, rated_id, stars)
  values (p_chain_id, v_me, p_rated_id, p_stars)
  returning transaction_ratings.chain_id, transaction_ratings.rated_id, transaction_ratings.stars, transaction_ratings.created_at;
end $$;

GRANT EXECUTE ON FUNCTION public.rate_chain_transaction(uuid, uuid, int) TO authenticated;

-- ------------------------------------------------------------
-- Il MIO voto su un partecipante di una catena (per sapere se mostrare le
-- stelle in chat_chain). Solo il proprio: quello dell'altra parte resta
-- dietro il double-blind, stesso schema di my_rating_for_offer.
-- ------------------------------------------------------------
CREATE FUNCTION public.my_rating_for_chain(p_chain_id uuid, p_rated_id uuid)
RETURNS int
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.stars FROM public.transaction_ratings r
  WHERE r.chain_id = p_chain_id AND r.rater_id = auth.uid() AND r.rated_id = p_rated_id;
$$;

GRANT EXECUTE ON FUNCTION public.my_rating_for_chain(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------
-- get_user_rating: ora aggrega ANCHE i voti di catena rivelati, non solo
-- quelli 1:1 — altrimenti l'estensione sopra non cambierebbe nulla di
-- visibile. Rivelato per una coppia di catena = esiste la riga reciproca
-- (stesso chain_id, rater/rated invertiti) oppure sono passati 14 giorni.
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
      (r.offer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.transaction_ratings r2
        WHERE r2.offer_id = r.offer_id AND r2.rater_id <> r.rater_id
      ))
      OR (r.chain_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.transaction_ratings r2
        WHERE r2.chain_id = r.chain_id AND r2.rater_id = r.rated_id AND r2.rated_id = r.rater_id
      ))
      OR r.created_at < now() - interval '14 days'
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_user_rating(uuid) TO anon, authenticated;
