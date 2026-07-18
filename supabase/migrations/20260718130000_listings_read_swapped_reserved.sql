-- ============================================================
-- Fix: nello storico (Attività -> "Ricevuto") l'annuncio ricevuto in uno
-- scambio compariva come "Annuncio" invece del titolo vero.
--
-- Causa: listings_read_all_active permette la lettura pubblica di un
-- annuncio non tuo solo per gli stati 'active','sold','exchanged',
-- 'paused','archived' (oltre ai propri, via user_id = auth.uid()).
-- 'swapped' e 'reserved' sono stati aggiunti all'enum listing_status in
-- un secondo momento (20260711160005_add_missing_listing_statuses.sql)
-- ma questa policy, definita prima in init.sql, non è mai stata estesa
-- per includerli.
--
-- Effetto pratico: quando uno scambio si conclude, l'annuncio della
-- controparte passa a 'swapped' (e un acquisto accettato a 'reserved') —
-- da quel momento chi lo ha RICEVUTO (non ne è proprietario) non può più
-- leggerne titolo/dettagli. listMyTransactions() fa una join embedded su
-- listings che silenziosamente ritorna null se la RLS blocca la riga,
-- quindi la UI ripiega sul placeholder "Annuncio" — niente errore
-- visibile, solo dati mancanti.
--
-- Fix: aggiunge 'swapped' e 'reserved' allo stesso bucket già pubblico di
-- sold/exchanged/archived — stesso livello di esposizione già accettato
-- per quegli stati "non più disponibili per una transazione", nessuna
-- nuova superficie di rischio (il PNR resta comunque solo in
-- listing_secrets, mai in listings).
-- ============================================================

ALTER POLICY listings_read_all_active ON public.listings
  USING (
    (status = ANY (ARRAY[
      'active'::public.listing_status,
      'sold'::public.listing_status,
      'exchanged'::public.listing_status,
      'paused'::public.listing_status,
      'archived'::public.listing_status,
      'swapped'::public.listing_status,
      'reserved'::public.listing_status
    ]))
    OR (user_id = auth.uid())
  );
