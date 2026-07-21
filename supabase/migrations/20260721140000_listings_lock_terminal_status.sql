-- Un annuncio venduto/scambiato (transazione conclusa) non deve più essere
-- modificabile: prima il controllo esisteva solo lato client (bottone
-- "Modifica" nascosto in ListingDetailScreen/ProfileScreen), quindi
-- bypassabile chiamando direttamente supabase.from('listings').update() —
-- le RLS listings_owner_update/listings_update_user verificano solo
-- "auth.uid() = user_id", nessuna condizione sullo status.
--
-- Si applica SOLO quando lo stato di PARTENZA è già concluso: una riga che
-- sta transitando DA active/pending/reserved VERSO sold/swapped (l'esito
-- normale di un'offerta accettata, vedi accept_offer/after_update_offers_propagate)
-- non è toccata da questo controllo, perché lì OLD.status non è ancora
-- concluso. Un update "no-op" (nessuna colonna realmente cambiata) resta
-- permesso, per non rompere eventuali riscritture idempotenti.
CREATE OR REPLACE FUNCTION public.before_update_listings_lock_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  if lower(old.status::text) in ('sold', 'swapped', 'exchanged', 'traded')
     and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'listing % is already %: concluded listings cannot be modified', old.id, old.status;
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_listings_lock_terminal ON public.listings;
CREATE TRIGGER trg_listings_lock_terminal
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.before_update_listings_lock_terminal();
