-- ============================================================
-- Stato "in verifica" per gli annunci che l'AI non è riuscita a valutare.
--
-- Fino a ieri, quando la verifica AI falliva (quota OpenAI esaurita, 429,
-- chiave mancante) il punteggio veniva comunque calcolato sulle sole
-- euristiche e tappato a 55. Due conseguenze, entrambe sbagliate:
--
--   - al compratore l'annuncio appariva con un badge ROSSO, cioè "abbiamo
--     controllato e non convince". Falso: non era stato controllato niente.
--     L'utente veniva penalizzato per un guasto NOSTRO;
--   - quel 55 stava SOPRA la soglia del gate di pubblicazione (50), quindi
--     un annuncio non verificato passava il controllo e finiva online —
--     esattamente il contrario di quello che serviva.
--
-- Ora la verifica fallita non produce nessun punteggio: trust_score resta
-- NULL (valore che le query del feed già escludono da qualunque filtro di
-- affidabilità) e l'annuncio viene marcato con trust_pending_at.
--
-- Serve una colonna dedicata perché trust_score NULL da solo è ambiguo:
-- significa già "mai verificato" (annuncio vecchio, importato, mai passato
-- dal Check AI). Senza distinguere i due casi, il ritentativo non saprebbe
-- quali annunci riprendere e li ripasserebbe tutti a ogni apertura dell'app.
-- ============================================================

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS trust_pending_at timestamptz;

COMMENT ON COLUMN public.listings.trust_pending_at IS
  'Istante dell''ultimo tentativo di verifica AI FALLITO. NULL = nessuna verifica in sospeso. Diverso da trust_score IS NULL, che significa "mai verificato".';

-- Solo le righe in attesa: l''indice resta minuscolo anche con il catalogo
-- pieno, perché in condizioni normali questa colonna è NULL ovunque.
CREATE INDEX IF NOT EXISTS ix_listings_trust_pending
  ON public.listings (user_id, trust_pending_at)
  WHERE trust_pending_at IS NOT NULL;


-- ------------------------------------------------------------
-- Quando una verifica RIESCE, lo stato in sospeso si chiude da solo.
--
-- update_listing_trust_score è il trigger che propaga il punteggio da
-- trust_audit a listings: è il punto esatto in cui sappiamo che la verifica
-- è andata a buon fine, quindi è lì che va azzerato trust_pending_at.
-- Lasciarlo a carico del codice applicativo significherebbe dimenticarlo in
-- uno dei percorsi (app, Messenger, ritentativo) e lasciare annunci che
-- vengono ricontrollati per sempre.
--
-- Parte dalla versione di 20260726120000 (che salta gli annunci conclusi),
-- non da quella di 20260724120000.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_listing_trust_score() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.listing_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(status::text) INTO v_status
  FROM public.listings WHERE id = NEW.listing_id;

  IF v_status IS NULL OR v_status IN ('sold', 'swapped', 'exchanged', 'traded') THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.sync_trust_score', 'on', true);
  UPDATE public.listings
  SET trust_score = NEW.trust_score,
      -- La verifica è riuscita: non c'è più niente in sospeso.
      trust_pending_at = NULL
  WHERE id = NEW.listing_id;
  PERFORM set_config('app.sync_trust_score', 'off', true);

  RETURN NEW;
END;
$$;


-- ------------------------------------------------------------
-- Gli annunci del chiamante che aspettano una verifica.
--
-- Il progetto non ha uno scheduler: la manutenzione periodica si aggancia a
-- una schermata che l'utente apre comunque (stesso schema già usato da
-- expire_my_stale_listings e release_my_stale_reservations). Questa funzione
-- è la lista che il client chiede all'apertura del Profilo per rilanciare i
-- Check AI rimasti indietro.
--
-- SECURITY DEFINER + filtro su auth.uid(): ognuno vede solo i propri.
-- Esclusi gli stati conclusi, dove un punteggio non serve più a niente.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_listings_pending_trust(max_rows int DEFAULT 10)
RETURNS TABLE(id uuid, title text, status text, trust_pending_at timestamptz)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.title, l.status::text, l.trust_pending_at
  FROM public.listings l
  WHERE l.user_id = auth.uid()
    AND l.trust_pending_at IS NOT NULL
    AND l.status::text NOT IN ('sold','swapped','exchanged','traded','deleted','archived')
  ORDER BY l.trust_pending_at ASC
  LIMIT greatest(1, least(coalesce(max_rows, 10), 25));
$$;

GRANT EXECUTE ON FUNCTION public.list_my_listings_pending_trust(int) TO authenticated;
