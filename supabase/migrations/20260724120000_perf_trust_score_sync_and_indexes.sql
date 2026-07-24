-- ============================================================
-- Performance + un bug di correttezza emerso durante l'analisi.
--
-- 1) BUG: listings.trust_score è congelato dal 20260717200000.
--    Il trigger trg_update_listing_trust_score (AFTER INSERT su trust_audit)
--    fa `UPDATE listings SET trust_score = NEW.trust_score`. Quell'UPDATE
--    fa scattare trg_listings_lock_columns (BEFORE UPDATE su listings), che
--    esegue `new.trust_score := old.trust_score` — riportando il valore a
--    quello vecchio. Da allora la colonna non è mai più cambiata dopo
--    l'INSERT iniziale (l'INSERT non passa da un trigger BEFORE UPDATE).
--    Effetto visibile: il badge di affidabilità che l'app legge da
--    listings.trust_score (LISTING_PUBLIC_COLUMNS in lib/db.js, mostrato in
--    Home / Dettaglio annuncio / Profilo) resta fermo al valore del primo
--    Check AI, anche dopo un nuovo Check AI con esito diverso.
--
-- 2) PERF: il feed pubblico leggeva l'affidabilità da v_latest_trustscore,
--    una view che fa GROUP BY sull'INTERA trust_audit a ogni chiamata. Con
--    la colonna di nuovo affidabile (punto 1) il server può leggerla
--    direttamente dalla riga e ordinare/filtrare in SQL invece che in
--    memoria dopo la paginazione.
--
-- 3) PERF: indici mancanti per i pattern di accesso più frequenti.
--
-- 4) PERF: list_my_chats riscritta con UNION ALL (l'OR su due tabelle
--    impediva l'uso degli indici).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Sblocco della sincronizzazione trust_score
-- ------------------------------------------------------------
-- La colonna resta protetta da qualunque client: il lock salta SOLO durante
-- la finestra aperta dal trigger di denormalizzazione, con un parametro
-- locale alla transazione (set_config(..., is_local => true)), che PostgREST
-- non permette a un client di impostare per conto proprio.
CREATE OR REPLACE FUNCTION public.update_listing_trust_score() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- niente da propagare per gli audit non legati a un annuncio (listing_id
  -- nullo: il Check AI lanciato prima che l'annuncio esista)
  IF NEW.listing_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.sync_trust_score', 'on', true);
  UPDATE public.listings
  SET trust_score = NEW.trust_score
  WHERE id = NEW.listing_id;
  PERFORM set_config('app.sync_trust_score', 'off', true);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.before_update_listings_lock_columns() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.user_id := old.user_id;
  -- trust_score: scrivibile solo dalla pipeline server-side, cioè dal trigger
  -- su trust_audit che apre la finestra qui sotto. Ogni altra strada (app,
  -- chiamata diretta a PostgREST, script) resta bloccata come prima.
  if coalesce(current_setting('app.sync_trust_score', true), 'off') <> 'on' then
    new.trust_score := old.trust_score;
  end if;
  new.ai_reliability := old.ai_reliability;
  new.ai_reliability_expl := old.ai_reliability_expl;
  new.ai_reliability_updated_at := old.ai_reliability_updated_at;
  return new;
end;
$$;

-- Riallineamento delle righe rimaste indietro nel periodo del bug: prende
-- l'ultimo audit di ogni annuncio (stessa definizione di v_latest_trustscore).
-- Aggiorna solo dove il valore differisce davvero, per non toccare inutilmente
-- righe già corrette (ogni UPDATE fa scattare gli altri trigger su listings).
DO $$
BEGIN
  PERFORM set_config('app.sync_trust_score', 'on', true);
  UPDATE public.listings l
  SET trust_score = v.trust_score
  FROM public.v_latest_trustscore v
  WHERE v.listing_id = l.id
    AND l.trust_score IS DISTINCT FROM v.trust_score;
  PERFORM set_config('app.sync_trust_score', 'off', true);
END $$;

-- ------------------------------------------------------------
-- 2/3) Indici
-- ------------------------------------------------------------
-- Il feed pubblico filtra sempre status='active' e ordina per created_at DESC:
-- esistevano solo gli indici separati su status e su created_at, che
-- costringono a un sort dopo il filtro.
CREATE INDEX IF NOT EXISTS idx_listings_active_created
  ON public.listings (created_at DESC)
  WHERE status = 'active';

-- Ordinamento per affidabilità (sort=trust_desc/trust_asc nel feed), ora
-- eseguito in SQL invece che in memoria sulla pagina già estratta.
CREATE INDEX IF NOT EXISTS idx_listings_active_trust
  ON public.listings (trust_score DESC NULLS LAST)
  WHERE status = 'active';

-- v_latest_trustscore resta usata altrove (e dal backfill qui sopra): questo
-- indice le evita la scansione completa di trust_audit.
CREATE INDEX IF NOT EXISTS idx_trust_audit_listing_created
  ON public.trust_audit (listing_id, created_at DESC);

-- ------------------------------------------------------------
-- 4) list_my_chats: UNION ALL al posto dell'OR
-- ------------------------------------------------------------
-- Prima: `WHERE ... AND (o.proposer_id = auth.uid() OR tl.user_id = auth.uid())`.
-- L'OR mette in relazione due TABELLE diverse (offers e listings), quindi il
-- pianificatore non può usare né idx_offers_proposer né l'indice su listings
-- e finisce per scandire offers per intero: costo che cresce con TUTTE le
-- proposte della piattaforma, non con quelle dell'utente.
-- Ora: due rami indicizzabili uniti da UNION ALL. Un'offerta in cui l'utente
-- è sia proponente sia proprietario dell'annuncio non esiste (una proposta su
-- un proprio annuncio è già impedita), quindi UNION ALL non può duplicare
-- righe — e costa meno di UNION, che aggiungerebbe una deduplica inutile.
-- Contenuto delle colonne invariato rispetto alla versione 20260721210000.
DROP FUNCTION IF EXISTS public.list_my_chats();
CREATE FUNCTION public.list_my_chats()
RETURNS TABLE(
  offer_id text, type text, status text,
  to_listing_id text, to_listing_title text, from_listing_title text,
  last_body text, last_at timestamp with time zone,
  unread_count integer, updated_at timestamp with time zone,
  i_confirmed boolean, other_confirmed boolean, disputed boolean
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  WITH mine AS (
    SELECT o.*
    FROM public.offers o
    WHERE o.status::text IN ('accepted', 'finalized')
      AND o.proposer_id = auth.uid()
    UNION ALL
    SELECT o.*
    FROM public.offers o
    JOIN public.listings tl2 ON tl2.id = o.to_listing_id
    WHERE o.status::text IN ('accepted', 'finalized')
      AND tl2.user_id = auth.uid()
      AND o.proposer_id <> auth.uid()
  )
  SELECT
    o.id::text, o.type, o.status::text,
    tl.id::text, tl.title, fl.title,
    lm.body, lm.created_at,
    COALESCE((
      SELECT count(*) FROM public.chat_messages m2
      WHERE m2.offer_id = o.id AND m2.read_at IS NULL AND m2.sender_id <> auth.uid()
    ), 0)::int,
    o.updated_at,
    case when tl.user_id = auth.uid() then o.owner_confirmed_at is not null
         else o.proposer_confirmed_at is not null end,
    case when tl.user_id = auth.uid() then o.proposer_confirmed_at is not null
         else o.owner_confirmed_at is not null end,
    o.disputed_at is not null
  FROM mine o
  JOIN public.listings tl ON tl.id = o.to_listing_id
  LEFT JOIN public.listings fl ON fl.id = o.from_listing_id
  LEFT JOIN LATERAL (
    SELECT m.body, m.created_at FROM public.chat_messages m
    WHERE m.offer_id = o.id ORDER BY m.created_at DESC LIMIT 1
  ) lm ON true
  ORDER BY COALESCE(lm.created_at, o.updated_at) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_chats() TO authenticated;
