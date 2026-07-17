-- ============================================================
-- Scambio reale tra due VENDO (Soluzione B).
--
-- Uno scambio ha senso solo tra due biglietti reali (due VENDO): finché
-- l'annuncio dichiarava solo "cosa vendo", il sistema non sapeva "cosa
-- accetto in cambio", quindi non poteva abbinare due venditori che si
-- incastrano (io ho X e voglio Y; tu hai Y e vuoi X).
--
-- Aggiungiamo due colonne:
--   • accepts_swap: il VENDO è disposto a ricevere uno scambio.
--   • swap_wanted (jsonb): cosa cerca in cambio, es.
--       { "type": "train", "from": "Roma", "to": "Milano", "note": "..." }
--       { "type": "hotel", "location": "Firenze", "note": "..." }
--
-- Il matching (server) usa questi campi per proporre scambi compatibili e
-- marcare come "reciproci" i casi in cui entrambi vogliono ciò che l'altro
-- offre. Nessun impatto sugli annunci esistenti (default: nessuno scambio).
-- ============================================================

alter table public.listings
  add column if not exists accepts_swap boolean not null default false,
  add column if not exists swap_wanted jsonb;

-- Indice parziale: velocizza il recupero dei soli annunci aperti allo scambio.
create index if not exists idx_listings_accepts_swap
  on public.listings (accepts_swap)
  where accepts_swap = true;
