-- ============================================================
-- TravelSwapAI — Hardening privacy tabella `profiles`
-- Da eseguire UNA volta nel SQL Editor del progetto Supabase.
--
-- PROBLEMA: le policy RLS attuali su `profiles` sono permissive con
-- USING (true) ("Public read profiles", "profiles_read_all"). La RLS
-- protegge le RIGHE, non le COLONNE: chiunque abbia la anon key (che
-- viaggia nel bundle dell'app, quindi di fatto pubblica) può leggere
-- TUTTE le colonne di QUALSIASI profilo, incluse `phone` ed `email`.
--
-- SOLUZIONE: esporre i soli dati pubblici tramite una VISTA dedicata
-- (`public_profiles`) e restringere la tabella `profiles` alla lettura
-- del solo proprietario. L'app legge il profilo altrui dalla vista
-- (vedi lib/db.js -> getPublicProfile), il proprio profilo dalla tabella.
-- ============================================================

-- 1) Vista pubblica: SOLO colonne non sensibili (mai phone/email)
create or replace view public.public_profiles as
  select id, full_name, username, avatar_url, bio, created_at, counters
  from public.profiles;

-- La vista è di proprietà del ruolo che la crea (postgres) e per default
-- NON usa security_invoker: bypassa quindi la RLS della tabella ed espone
-- esattamente e solo le colonne selezionate qui sopra.
grant select on public.public_profiles to anon, authenticated;

-- 2) Restringi la lettura DIRETTA della tabella al solo proprietario.
--    Rimuove le policy permissive USING(true) che esponevano tutto.
drop policy if exists "Public read profiles" on public.profiles;
drop policy if exists profiles_read_all on public.profiles;

-- Assicura che esista una policy owner-only per il proprio profilo
-- (idempotente: se già presente, la ricrea uguale).
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  using (auth.uid() = id);

-- Nota: dopo questo script, un SELECT diretto su `profiles` di un altro
-- utente restituisce 0 righe (corretto). L'app continua a funzionare
-- perché legge i profili altrui dalla vista `public_profiles`.
