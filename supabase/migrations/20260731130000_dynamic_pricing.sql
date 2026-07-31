-- ============================================================
-- TravelSwapAI — Prezzo dinamico (decadimento automatico verso la partenza)
--
-- Un biglietto treno (o una prenotazione hotel) vale il prezzo pieno fino
-- a un attimo prima della partenza/check-in, poi vale zero: a differenza
-- di un marketplace generico, qui il "deperimento" è certo e calcolabile.
-- Il venditore può attivare, per singolo annuncio VENDO, uno sconto
-- automatico che scende linearmente negli ultimi N giorni prima
-- dell'evento (depart_at per i treni, check_in per gli hotel), fino a un
-- prezzo minimo che decide lui — mai sotto quello.
--
-- Design (vedi discussione): non si fa scendere "price" da un cron senza
-- un ancoraggio, altrimenti la curva perderebbe il riferimento ad ogni
-- tick. "list_price" è il prezzo di partenza della curva (impostato dal
-- CLIENT quando il venditore attiva il toggle o modifica il prezzo a
-- dynamic pricing già attivo — vedi CreateListingScreen), "price" è il
-- prezzo corrente/effettivo che tutto il resto del codice già legge
-- (matching, offerte, card): il cron aggiorna SOLO "price", verso il
-- basso, mai oltre "price_floor". Se "list_price" restasse disallineato
-- per un client non ufficiale che scrive price senza aggiornarlo, il
-- danno è comunque limitato: il cron clampa sempre il nuovo prezzo al
-- minimo tra quello corrente e quello calcolato (mai un aumento), quindi
-- nel peggiore dei casi lo sconto è "sbagliato" ma mai un modo per far
-- salire il prezzo o bypassare il pavimento.
-- ============================================================

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS dynamic_pricing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_floor numeric(10,2),
  ADD COLUMN IF NOT EXISTS list_price numeric(10,2);

-- Il pavimento non può essere negativo.
ALTER TABLE public.listings
  ADD CONSTRAINT listings_price_floor_nonneg_check
    CHECK (price_floor IS NULL OR price_floor >= 0);

-- Il pavimento non può superare né il prezzo corrente né quello di partenza
-- della curva (altrimenti la curva "salirebbe" invece di scendere).
ALTER TABLE public.listings
  ADD CONSTRAINT listings_price_floor_le_price_check
    CHECK (price_floor IS NULL OR price IS NULL OR price_floor <= price);

ALTER TABLE public.listings
  ADD CONSTRAINT listings_price_floor_le_list_price_check
    CHECK (price_floor IS NULL OR list_price IS NULL OR price_floor <= list_price);

-- Il toggle richiede entrambi i valori della curva, e ha senso solo su un
-- VENDO (un CERCO usa "price" come budget massimo, non come prezzo di
-- vendita: non c'è nulla da "scontare").
ALTER TABLE public.listings
  ADD CONSTRAINT listings_dynamic_pricing_requires_fields_check
    CHECK (
      dynamic_pricing_enabled = false
      OR (price_floor IS NOT NULL AND list_price IS NOT NULL AND cerco_vendo = 'VENDO')
    );

-- Nuovo tipo di notifica in-app: "il prezzo del tuo annuncio è sceso".
-- Vedi CLAUDE.md: prima di riscrivere notifications_type_check, usare
-- come base la versione cronologicamente più recente (qui:
-- 20260730180000_pending_confirm_and_rating_reminders.sql), mai una
-- versione intermedia a memoria.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('offer_received','offer_accepted','offer_declined','new_matches',
                  'listing_ping','listing_question','listing_question_answered',
                  'chain_canceled','offer_cancelled','dispute_resolved',
                  'offer_confirm_reminder','offer_rating_reminder',
                  'listing_price_dropped'));
