-- Operatore (solo treni: Trenitalia, Italo…). Ricavato dall'AI (Compila AI
-- sul testo, import PDF del biglietto, import da conferma incollata) — mai
-- richiesto esplicitamente all'utente. Mostrato SOLO nel dettaglio annuncio
-- (la UI di ListingDetailScreen lo renderizza già, in attesa di questo dato
-- reale), mai nelle card di Esplora.
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS operator text;
