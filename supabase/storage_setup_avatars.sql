-- ============================================================
-- TravelSwapAI — Storage per la foto profilo utente
-- Da eseguire UNA volta nel SQL Editor del progetto Supabase.
-- Crea il bucket pubblico "avatars" e le policy di accesso.
-- Stesso pattern di storage_setup.sql (foto annunci), un bucket dedicato.
-- ============================================================

-- 1) Bucket pubblico (l'avatar è visibile a tutti in lettura)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 2) Lettura pubblica dei file del bucket
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- 3) Upload consentito agli utenti autenticati (nel solo bucket avatars)
drop policy if exists "avatars_auth_upload" on storage.objects;
create policy "avatars_auth_upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars');

-- 4) Ogni utente può sovrascrivere/cancellare solo il proprio avatar
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid());

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid());
