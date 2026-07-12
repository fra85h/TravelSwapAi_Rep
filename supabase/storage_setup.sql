-- ============================================================
-- TravelSwapAI — Storage per le foto degli annunci
-- Da eseguire UNA volta nel SQL Editor del progetto Supabase.
-- Crea il bucket pubblico "listing-images" e le policy di accesso.
-- ============================================================

-- 1) Bucket pubblico (le foto degli annunci sono visibili a tutti in lettura)
insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

-- 2) Lettura pubblica dei file del bucket
drop policy if exists "listing_images_public_read" on storage.objects;
create policy "listing_images_public_read"
  on storage.objects for select
  using (bucket_id = 'listing-images');

-- 3) Upload consentito agli utenti autenticati (nel solo bucket delle foto)
drop policy if exists "listing_images_auth_upload" on storage.objects;
create policy "listing_images_auth_upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-images');

-- 4) Ogni utente può cancellare/aggiornare solo i file che ha caricato
drop policy if exists "listing_images_owner_delete" on storage.objects;
create policy "listing_images_owner_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'listing-images' and owner = auth.uid());

drop policy if exists "listing_images_owner_update" on storage.objects;
create policy "listing_images_owner_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'listing-images' and owner = auth.uid());
