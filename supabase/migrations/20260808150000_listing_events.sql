-- 20260808150000_listing_events.sql
--
-- La storia di un annuncio: com'è cambiato il prezzo, e quando è finito.
--
-- PERCHÉ ADESSO, CHE NON SERVE A NESSUNO.
--
-- Il dato che serve a rispondere "questo biglietto, a questo prezzo, quante
-- probabilità ha di vendersi entro venerdì?" è la storia: a quale prezzo un
-- annuncio è stato in vetrina, per quanto, e com'è andata a finire.
--
-- Oggi quella storia si sta cancellando da sola, ogni ora:
--
--   • listings.price viene SOVRASCRITTO dal cron del prezzo dinamico a ogni
--     giro, e da ogni modifica manuale. Sopravvive solo l'ultimo valore:
--     "è stato a 70€, poi a 55€, venduto a 40€" non è ricostruibile;
--   • listings.updated_at cambia a OGNI scrittura, quindi non dice quando
--     l'annuncio è diventato 'sold' o 'expired' — dice solo quand'è stato
--     toccato l'ultima volta.
--
-- Nessuna delle due si recupera a posteriori. Questa tabella non produce
-- niente di visibile: rende possibile, fra qualche mese, una cosa che
-- altrimenti non lo sarebbe più.
--
-- PERCHÉ UN TRIGGER E NON L'APP. Il prezzo lo riscrive soprattutto il cron,
-- che passa da PostgREST; e chiunque domani tocchi la tabella da un altro
-- client la aggirerebbe. Sta a DB per la stessa ragione per cui ci stanno le
-- regole CERCO/VENDO: è la difesa che vale per qualunque client.

CREATE TABLE IF NOT EXISTS public.listing_events (
  id bigserial PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  -- 'created' = la riga alla nascita; 'price' = il prezzo è cambiato;
  -- 'status'  = lo stato è cambiato (è così che si data la fine).
  kind text NOT NULL CHECK (kind IN ('created', 'price', 'status')),
  price numeric(10,2),
  status public.listing_status,
  -- Il prezzo dinamico riscrive da solo: serve a distinguere una discesa
  -- automatica da una scelta del venditore, che sono due cose diverse per
  -- chiunque guarderà questi dati.
  dynamic boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.listing_events IS
  'Storia di prezzo e stato di ogni annuncio. Serve a stimare la probabilità di vendita: listings.price viene sovrascritto dal decadimento automatico e non è ricostruibile a posteriori. Solo scrittura da trigger, lettura solo service_role.';

CREATE INDEX IF NOT EXISTS idx_listing_events_listing_at
  ON public.listing_events (listing_id, at);

-- ------------------------------------------------------------
-- RLS: nessuno la legge dal client.
--
-- È materiale di analisi, non contenuto: contiene la storia dei ribassi di
-- tutti, e mostrarla a chi compra cambierebbe il comportamento di chi vende.
-- Attivare la RLS senza definire nessuna policy significa esattamente
-- "nessun accesso": passa solo service_role, che le scavalca.
-- ------------------------------------------------------------
ALTER TABLE public.listing_events ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Il trigger.
--
-- Si scrive una riga SOLO quando qualcosa cambia davvero (IS DISTINCT FROM),
-- altrimenti il cron orario riempirebbe la tabella di righe identiche.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.after_listing_write_record_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.listing_events (listing_id, kind, price, status, dynamic)
    VALUES (NEW.id, 'created', NEW.price, NEW.status, COALESCE(NEW.dynamic_pricing_enabled, false));
    RETURN NULL;
  END IF;

  IF NEW.price IS DISTINCT FROM OLD.price THEN
    INSERT INTO public.listing_events (listing_id, kind, price, status, dynamic)
    VALUES (NEW.id, 'price', NEW.price, NEW.status, COALESCE(NEW.dynamic_pricing_enabled, false));
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.listing_events (listing_id, kind, price, status, dynamic)
    VALUES (NEW.id, 'status', NEW.price, NEW.status, COALESCE(NEW.dynamic_pricing_enabled, false));
  END IF;

  RETURN NULL;
END;
$$;

-- AFTER e non BEFORE: la storia registra ciò che è successo, e se la
-- scrittura sull'annuncio venisse annullata questa riga sparirebbe con lei
-- (stessa transazione). Non deve mai poter impedire una scrittura.
DROP TRIGGER IF EXISTS after_listing_write_record_event ON public.listings;
CREATE TRIGGER after_listing_write_record_event
AFTER INSERT OR UPDATE OF price, status ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.after_listing_write_record_event();

-- ------------------------------------------------------------
-- Il passato che si può ancora salvare.
--
-- Degli annunci già esistenti non abbiamo la storia — è proprio il punto —
-- ma almeno il loro stato di oggi va messo a verbale, altrimenti quelli
-- pubblicati prima di questa migration resterebbero senza nemmeno un punto
-- di partenza. `published_at` come data dell'evento, non now(): la riga
-- descrive la nascita dell'annuncio, non il momento in cui l'abbiamo
-- registrata.
-- ------------------------------------------------------------
INSERT INTO public.listing_events (listing_id, at, kind, price, status, dynamic)
SELECT l.id, COALESCE(l.published_at, l.created_at, now()), 'created',
       l.price, l.status, COALESCE(l.dynamic_pricing_enabled, false)
FROM public.listings l
WHERE NOT EXISTS (
  SELECT 1 FROM public.listing_events e WHERE e.listing_id = l.id
);
