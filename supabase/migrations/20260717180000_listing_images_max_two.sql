-- ============================================================
-- Limite di 2 foto per annuncio, anche a livello DB.
--
-- L'app limita già la scelta a 2 foto per annuncio (un biglietto o una
-- stanza/prenotazione non hanno bisogno di una galleria). Questo trigger è
-- la difesa a livello di DB, coerente con lo schema già usato per le altre
-- regole di business (vedi before_insert_offers_enforce): blocca l'inserimento
-- oltre il limite da qualunque client, non solo dall'app.
-- ============================================================

CREATE OR REPLACE FUNCTION public.before_insert_listing_images_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  cnt int;
begin
  select count(*) into cnt
  from public.listing_images
  where listing_id = new.listing_id;

  if cnt >= 2 then
    raise exception 'Massimo 2 foto per annuncio';
  end if;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_listing_images_max_two ON public.listing_images;

CREATE TRIGGER trg_listing_images_max_two
  BEFORE INSERT ON public.listing_images
  FOR EACH ROW EXECUTE FUNCTION public.before_insert_listing_images_enforce();
