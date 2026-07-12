-- ============================================================
-- Fix critico: listing_status non conteneva 'pending'/'reserved'/
-- 'swapped', valori impostati attivamente da accept_offer_any() e dal
-- trigger after_update_offers_propagate() quando un'offerta viene
-- accettata. Scoperto testando in locale accept_offer_any end-to-end:
-- ERROR: invalid input value for enum listing_status: "pending".
--
-- Prima di questo fix, accettare QUALSIASI offerta (buy o swap) falliva
-- sempre con questo errore in produzione.
--
-- ('sold' esiste già nell'enum originale; 'expired'/'deleted' erano
-- già stati aggiunti dall'hardening 20260711160001.)
-- ============================================================

alter type public.listing_status add value if not exists 'pending';
alter type public.listing_status add value if not exists 'reserved';
alter type public.listing_status add value if not exists 'swapped';
