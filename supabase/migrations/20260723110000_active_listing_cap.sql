-- Tetto agli annunci ATTIVI per utente: un annuncio è una richiesta/offerta
-- reale (CERCO/VENDO), non un post usa-e-getta — un utente che ne accumula
-- centinaia (visto durante un test con dati fake) fa esplodere il tempo del
-- ricalcolo AI dei match (una chiamata per annuncio attivo, vedi
-- server/src/models/matches.js) e non riflette un uso reale della
-- piattaforma. 10 annunci attivi contemporanei è ampio per un utente vero
-- (poche tratte/prenotazioni in vendita/ricerca alla volta) ma blocca
-- l'accumulo incontrollato.
--
-- Vale per: INSERT diretto in 'active' (nuovo annuncio) e per la
-- riattivazione MANUALE da 'paused' o 'expired' (le due uniche transizioni
-- verso 'active' che l'utente sceglie esplicitamente, vedi ProfileScreen
-- toggleStatus e CreateListingScreen riattivazione automatica).
--
-- NON si applica alle transizioni di SISTEMA verso 'active' che riportano
-- un annuncio a uno stato che aveva già prima (non sono una nuova
-- attivazione, e bloccarle lascerebbe l'annuncio bloccato in uno stato
-- intermedio senza via d'uscita): da 'reserved' quando una prenotazione
-- scade o uno scambio viene annullato (reservation_timeout,
-- two_sided_exchange_confirmation), da 'pending' quando le proposte di
-- scambio in corso scendono sotto soglia (fix_offer_status_norm_cast).
CREATE OR REPLACE FUNCTION public.enforce_active_listing_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_count int;
  cap constant int := 10;
BEGIN
  IF new.status = 'active'
     AND (tg_op = 'INSERT' OR old.status::text IN ('paused', 'expired'))
  THEN
    SELECT count(*) INTO active_count
    FROM public.listings
    WHERE user_id = new.user_id
      AND status = 'active'
      AND id <> new.id;
    IF active_count >= cap THEN
      RAISE EXCEPTION 'active listing cap reached (max % attivi) for user %', cap, new.user_id;
    END IF;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_listings_active_cap ON public.listings;
CREATE TRIGGER trg_listings_active_cap
  BEFORE INSERT OR UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_cap();
