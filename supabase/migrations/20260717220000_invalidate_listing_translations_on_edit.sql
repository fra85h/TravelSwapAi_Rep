-- ============================================================
-- Invalida la cache delle traduzioni quando titolo/descrizione cambiano.
--
-- listing_translations è chiave (listing_id, lang), senza alcun legame col
-- contenuto originale (nessun hash/timestamp del testo tradotto). Se un
-- venditore modifica titolo o descrizione dopo che una traduzione era già
-- stata generata e salvata (server/src/routes/translateListings.js), chi la
-- richiede di nuovo continuava a vedere la traduzione VECCHIA, del testo di
-- prima — anche con l'annuncio corretto nel frattempo (es. un errore
-- fattuale nella tratta/data). Nessun codice invalidava questa cache
-- all'update, né lato frontend (lib/db.js) né lato backend.
--
-- Fix: trigger DB, così copre qualunque client che aggiorna listings
-- (stesso principio di trg_listings_lock_columns / before_insert_offers_
-- enforce) invece di doverlo replicare in ogni punto che fa update.
-- ============================================================

-- SECURITY DEFINER: listing_translations ha RLS abilitata con la sola
-- policy "public read translations" (SELECT), nessuna policy di DELETE per
-- utenti autenticati/anon. L'update di listings che innesca questo trigger
-- arriva anche dal client (lib/db.js, con la sessione dell'utente, non il
-- service role): senza SECURITY DEFINER la DELETE qui sotto verrebbe
-- bloccata dalla RLS, e l'errore avrebbe fatto fallire l'intero UPDATE su
-- listings (non solo la pulizia della cache) per qualunque modifica di
-- titolo/descrizione da parte di un utente normale.
CREATE OR REPLACE FUNCTION public.after_update_listings_invalidate_translations() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if new.title is distinct from old.title or new.description is distinct from old.description then
    delete from public.listing_translations where listing_id = old.id;
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_listings_invalidate_translations ON public.listings;

CREATE TRIGGER trg_listings_invalidate_translations
  AFTER UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.after_update_listings_invalidate_translations();
