-- PUNTO 2a — Unicità del PNR: uno stesso biglietto non può essere in vendita
-- in più annunci "vivi" contemporaneamente (né dallo stesso venditore né,
-- soprattutto, da account diversi). È la difesa contro la doppia vendita
-- dello stesso posto, la truffa classica del secondary ticketing.
--
-- Il PNR resta un SEGRETO (listing_secrets, leggibile solo dall'owner): NON
-- lo copiamo in chiaro su listings. Su listings mettiamo solo una IMPRONTA
-- (md5 del PNR normalizzato), che basta a far scattare l'unicità senza
-- esporre il codice. L'impronta è mantenuta da un trigger su listing_secrets.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS pnr_fingerprint text;

-- Normalizzazione: solo alfanumerici, maiuscolo (i PNR sono case-insensitive
-- e possono arrivare con spazi/trattini).
CREATE OR REPLACE FUNCTION public.pnr_fingerprint(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  select case
    when nullif(btrim(coalesce(p, '')), '') is null then null
    else md5(upper(regexp_replace(p, '[^A-Za-z0-9]', '', 'g')))
  end;
$$;

-- Mantiene listings.pnr_fingerprint allineato al segreto PNR.
CREATE OR REPLACE FUNCTION public.sync_pnr_fingerprint()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
begin
  if tg_op = 'DELETE' then
    update public.listings set pnr_fingerprint = null where id = old.listing_id;
    return old;
  else
    update public.listings set pnr_fingerprint = public.pnr_fingerprint(new.pnr) where id = new.listing_id;
    return new;
  end if;
end $$;

DROP TRIGGER IF EXISTS trg_listing_secrets_fingerprint ON public.listing_secrets;
CREATE TRIGGER trg_listing_secrets_fingerprint
  AFTER INSERT OR UPDATE OR DELETE ON public.listing_secrets
  FOR EACH ROW EXECUTE FUNCTION public.sync_pnr_fingerprint();

-- Backfill delle righe già presenti.
UPDATE public.listings l
   SET pnr_fingerprint = public.pnr_fingerprint(s.pnr)
  FROM public.listing_secrets s
 WHERE s.listing_id = l.id;

-- Unicità solo tra annunci "vivi" (che rivendicano davvero il biglietto):
-- active/pending/reserved/paused. Un annuncio scaduto/venduto/scambiato/
-- eliminato ha liberato il biglietto e non conta.
DROP INDEX IF EXISTS ux_listings_live_pnr;
CREATE UNIQUE INDEX ux_listings_live_pnr
  ON public.listings (pnr_fingerprint)
  WHERE pnr_fingerprint IS NOT NULL
    AND status IN ('active','pending','reserved','paused');

-- Controllo pre-pubblicazione (il client blocca prima di inserire, l'indice
-- sopra è il backstop anti-race / anti-client alterato). SECURITY DEFINER:
-- deve vedere annunci di altri utenti, ma ritorna solo un booleano — nessuna
-- fuga del PNR. exclude_listing_id: il proprio annuncio in modifica non
-- conta come duplicato di se stesso.
CREATE OR REPLACE FUNCTION public.is_pnr_active(pnr_text text, exclude_listing_id text DEFAULT null)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  select exists (
    select 1 from public.listings l
    where l.pnr_fingerprint = public.pnr_fingerprint(pnr_text)
      and l.status in ('active','pending','reserved','paused')
      and (exclude_listing_id is null or l.id::text <> exclude_listing_id)
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_pnr_active(text, text) TO authenticated;
