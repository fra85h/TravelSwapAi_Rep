-- Check di plausibilità del PNR: non esiste un'API pubblica Trenitalia/Italo
-- per verificare se un PNR è REALMENTE esistente, quindi non possiamo
-- controllarne l'esistenza vera. Possiamo però scartare quelli palesemente
-- inventati (troppo corti/lunghi, o sequenze banali tipo "111111"/"ABCDEF")
-- usando lo stesso range 5–8 alfanumerici già indicato all'AI in fase di
-- import (vedi lib/descriptionParser.js). Il PNR resta opzionale: la funzione
-- ritorna true se assente, il check scatta solo quando è presente.
CREATE OR REPLACE FUNCTION public.pnr_is_plausible(p text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  norm text;
  n int;
  is_asc boolean := true;
  is_desc boolean := true;
  diff int;
BEGIN
  IF nullif(btrim(coalesce(p, '')), '') IS NULL THEN
    RETURN true;
  END IF;

  norm := upper(regexp_replace(p, '[^A-Za-z0-9]', '', 'g'));
  n := length(norm);
  IF n < 5 OR n > 8 THEN
    RETURN false;
  END IF;

  IF norm ~ '^(.)\1*$' THEN
    RETURN false; -- tutto lo stesso carattere ("111111", "AAAAAA")
  END IF;

  FOR i IN 2..n LOOP
    diff := ascii(substr(norm, i, 1)) - ascii(substr(norm, i - 1, 1));
    IF diff != 1 THEN is_asc := false; END IF;
    IF diff != -1 THEN is_desc := false; END IF;
  END LOOP;
  IF is_asc OR is_desc THEN
    RETURN false; -- sequenza banale crescente/decrescente ("123456", "FEDCBA")
  END IF;

  RETURN true;
END;
$$;

-- NOT VALID: non rivalida le righe già esistenti (potrebbero avere PNR salvati
-- prima di questo check), si applica solo a INSERT/UPDATE da qui in avanti.
-- Query per vedere quante righe esistenti violerebbero il check (solo
-- informativo, nessuna azione necessaria su queste):
--   SELECT listing_id, pnr FROM public.listing_secrets
--   WHERE NOT public.pnr_is_plausible(pnr);
ALTER TABLE public.listing_secrets
  DROP CONSTRAINT IF EXISTS chk_pnr_plausible;
ALTER TABLE public.listing_secrets
  ADD CONSTRAINT chk_pnr_plausible
  CHECK (public.pnr_is_plausible(pnr)) NOT VALID;
