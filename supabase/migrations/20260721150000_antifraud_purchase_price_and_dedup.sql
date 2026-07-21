-- Antifrode: (1) prezzo di acquisto + tetto anti-bagarinaggio, (2) blocco
-- annunci duplicati dello stesso venditore. Entrambe le regole valgono anche
-- via trigger/constraint DB, non solo lato client: è la difesa da qualunque
-- client, non solo dall'app ufficiale (vedi CLAUDE.md).

-- ============================================================
-- 1) Prezzo di acquisto + tetto (anti-bagarinaggio, Fase A)
-- ============================================================
-- purchase_price = prezzo a cui il venditore ha comprato il biglietto. Il
-- prezzo di vendita non può superarlo: chi rivende non può lucrare sopra il
-- valore nominale. Autodichiarato in questa fase (la verifica su PDF/AI è un
-- passo successivo, di solo assist); il tetto qui è comunque un vincolo duro.
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS purchase_price numeric(10,2);

-- price <= purchase_price quando entrambi presenti. Colonna nuova (tutti NULL
-- sulle righe esistenti), quindi nessuna riga preesistente viola il vincolo.
-- Non tocca i CERCO: lì purchase_price resta NULL e price è il budget.
ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS chk_price_le_purchase;
ALTER TABLE public.listings
  ADD CONSTRAINT chk_price_le_purchase
  CHECK (purchase_price IS NULL OR price IS NULL OR price <= purchase_price);

-- ============================================================
-- 2) Blocco annunci duplicati dello stesso venditore
-- ============================================================
-- Prima nulla impediva a un venditore di ripubblicare lo stesso annuncio
-- all'infinito (nessun vincolo, solo l'indice ux_listings_external sugli
-- import esterni). Un annuncio è "duplicato esatto" di un altro proprio
-- annuncio ATTIVO quando coincidono tipo, prezzo e — per i treni — tratta e
-- data/ora di partenza, per gli hotel località e check-in. Il confronto è
-- case-insensitive sui luoghi (stessa normalizzazione dell'app).
CREATE OR REPLACE FUNCTION public.before_insert_listings_block_duplicate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  if new.status = 'active' and exists (
    select 1
    from public.listings l
    where l.user_id = new.user_id
      and l.id <> new.id
      and l.status = 'active'
      and l.type = new.type
      and coalesce(l.price, -1) = coalesce(new.price, -1)
      and (
        (new.type = 'train'
          and lower(coalesce(l.route_from, '')) = lower(coalesce(new.route_from, ''))
          and lower(coalesce(l.route_to, ''))   = lower(coalesce(new.route_to, ''))
          and l.depart_at is not distinct from new.depart_at)
        or
        (new.type = 'hotel'
          and lower(coalesce(l.location, '')) = lower(coalesce(new.location, ''))
          and l.check_in is not distinct from new.check_in)
      )
  ) then
    raise exception 'duplicate active listing for user %', new.user_id
      using errcode = '23505';
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_listings_block_duplicate ON public.listings;
CREATE TRIGGER trg_listings_block_duplicate
  BEFORE INSERT ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.before_insert_listings_block_duplicate();
