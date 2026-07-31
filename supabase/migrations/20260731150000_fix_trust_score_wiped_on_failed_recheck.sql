-- ============================================================
-- Fix: un ricontrollo AI fallito cancellava un punteggio già valido.
--
-- Bug osservato: modificando un annuncio già pubblicato e verificato (es.
-- cambiando le foto, che forza un nuovo Check AI — vedi CreateListingScreen),
-- se quella NUOVA verifica falliva o restava "in sospeso" (chiave OpenAI
-- assente, 429, timeout), l'affidabilità sparisce del tutto dall'annuncio,
-- pur essendo l'annuncio invariato per il resto.
--
-- Causa: update_listing_trust_score (20260726140000) fa SEMPRE
-- "SET trust_score = NEW.trust_score" quando la verifica riesce O fallisce,
-- perché all'epoca il caso "verifica fallita" era pensato solo per un
-- annuncio MAI verificato prima (trust_score già NULL — vedi il commento
-- originale del file: "trust_score resta NULL... l'annuncio viene marcato
-- con trust_pending_at"). Non considerava il caso di un RI-controllo che
-- fallisce su un annuncio che aveva già un punteggio valido: lì
-- "trust_score = NEW.trust_score" scrive NULL sopra un numero buono,
-- cancellandolo — ListingDetailScreen/ProfileScreen, senza trust_pending_at
-- valorizzato (il ramo pending non scatta perché la UPDATE qui sotto lo
-- lasciava com'era) e senza un punteggio numerico, non mostrano nessun
-- badge: l'affidabilità sparisce silenziosamente, non "va in verifica".
--
-- Fix: un ricontrollo fallito NON tocca più un punteggio precedente valido
-- (si limita a registrare l'audit in trust_audit, cosa che succede comunque
-- a monte di questo trigger). Il ramo "resta in sospeso" (trust_pending_at)
-- si applica ora SOLO quando non esisteva ancora nessun punteggio da
-- proteggere — lo stesso caso per cui la colonna era stata introdotta.
--
-- Parte dalla versione di 20260726140000 (l'ultima cronologicamente).
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_listing_trust_score() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_status text;
  v_old_trust_score numeric;
BEGIN
  IF NEW.listing_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(status::text), trust_score INTO v_status, v_old_trust_score
  FROM public.listings WHERE id = NEW.listing_id;

  IF v_status IS NULL OR v_status IN ('sold', 'swapped', 'exchanged', 'traded') THEN
    RETURN NEW;
  END IF;

  IF NEW.trust_score IS NOT NULL THEN
    -- Verifica riuscita: propaga il nuovo punteggio, chiude qualunque "in sospeso".
    PERFORM set_config('app.sync_trust_score', 'on', true);
    UPDATE public.listings
    SET trust_score = NEW.trust_score,
        trust_pending_at = NULL
    WHERE id = NEW.listing_id;
    PERFORM set_config('app.sync_trust_score', 'off', true);
  ELSIF v_old_trust_score IS NULL THEN
    -- Mai verificato prima, e anche questo tentativo è fallito: resta "in
    -- sospeso" — non c'è nessun punteggio precedente da proteggere.
    UPDATE public.listings
    SET trust_pending_at = now()
    WHERE id = NEW.listing_id;
  END IF;
  -- Altrimenti (verifica fallita ma un punteggio valido esisteva già):
  -- non si tocca nulla. L'annuncio continua a mostrare l'ultimo punteggio
  -- buono; il tentativo fallito resta comunque tracciato in trust_audit
  -- per lo storico, semplicemente non si propaga a listings.

  RETURN NEW;
END;
$$;
