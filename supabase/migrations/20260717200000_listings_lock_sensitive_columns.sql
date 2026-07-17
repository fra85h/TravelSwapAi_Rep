-- ============================================================
-- Blocca a livello DB la modifica di colonne sensibili di listings via
-- UPDATE, indipendentemente dal client. Il backend Express applica già una
-- whitelist sui campi patchabili (vedi PATCHABLE_FIELDS in
-- server/src/models/listings.js), ma quella whitelist protegge solo la
-- strada che passa dal backend (che usa la SERVICE_ROLE_KEY, quindi bypassa
-- le RLS). L'app scrive anche direttamente su Supabase (lib/db.js) con lo
-- stesso schema "spalma tutto il patch": lì le RLS impediscono di cambiare
-- user_id (grazie al WITH CHECK auth.uid() = user_id), ma le RLS sono a
-- livello di RIGA, non di colonna, quindi non impediscono di scrivere
-- trust_score/ai_reliability* con qualunque valore. Questo trigger è il
-- backstop indipendente da qualunque client, coerente con le altre regole
-- di business critiche del progetto (vedi before_insert_offers_enforce).
--
-- user_id: la proprietà di un annuncio non deve mai cambiare via update
-- (impedisce il dirottamento di un annuncio da un account a un altro).
-- trust_score/ai_reliability*: calcolati SOLO dalla pipeline server-side
-- (server/src/routes/trustscore.js -> tabella trust_audit); nessun codice
-- del progetto scrive legittimamente su queste colonne di listings.
-- ============================================================

CREATE OR REPLACE FUNCTION public.before_update_listings_lock_columns() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.user_id := old.user_id;
  new.trust_score := old.trust_score;
  new.ai_reliability := old.ai_reliability;
  new.ai_reliability_expl := old.ai_reliability_expl;
  new.ai_reliability_updated_at := old.ai_reliability_updated_at;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_listings_lock_columns ON public.listings;

CREATE TRIGGER trg_listings_lock_columns
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.before_update_listings_lock_columns();
