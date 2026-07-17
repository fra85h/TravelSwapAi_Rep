-- ============================================================
-- Fix race condition sul limite di 2 foto per annuncio.
--
-- Il trigger prima leggeva COUNT(*) senza alcun lock: due insert
-- concorrenti sulla stessa listing_id potevano entrambi leggere cnt=1
-- (1 foto già presente) prima che l'altro completasse, e passare
-- entrambi il controllo "< 2", risultando in 3 foto salvate.
--
-- Fix: si acquisisce un lock a livello di riga sull'annuncio genitore
-- (SELECT ... FOR UPDATE su listings, non su listing_images) prima del
-- conteggio. Due insert concorrenti sulla stessa listing_id si serializzano
-- sul lock della riga in listings: il secondo aspetta il commit del primo e
-- quindi vede il conteggio aggiornato. Nessun impatto su insert verso
-- listing_id diverse (righe diverse, lock diversi).
-- ============================================================

CREATE OR REPLACE FUNCTION public.before_insert_listing_images_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  cnt int;
begin
  PERFORM 1 FROM public.listings WHERE id = new.listing_id FOR UPDATE;

  select count(*) into cnt
  from public.listing_images
  where listing_id = new.listing_id;

  if cnt >= 2 then
    raise exception 'Massimo 2 foto per annuncio';
  end if;

  return new;
end;
$$;
