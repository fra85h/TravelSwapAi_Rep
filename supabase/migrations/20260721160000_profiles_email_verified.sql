-- Verifica identità "leggera": badge Email verificata sul profilo venditore,
-- basato sulla conferma email di Supabase (nessun provider esterno). Il
-- segnale è esposto pubblicamente (chi compra deve poterlo vedere), quindi
-- serve una colonna dedicata sul profilo + la sua sincronizzazione da
-- auth.users, e va aggiunta alla vista public_profiles. Lo "storico" (numero
-- di scambi/vendite) è già esposto via profiles.counters, letto dall'app.

-- 1) Colonna pubblica sul profilo.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;

-- 2) Backfill dagli utenti già confermati.
UPDATE public.profiles p
   SET email_verified = true
  FROM auth.users u
 WHERE u.id = p.id
   AND u.email_confirmed_at IS NOT NULL;

-- 3) Sincronizzazione alla conferma email (auth.users → profiles). L'app non
--    può scrivere questo flag (non è tra le colonne aggiornabili dal client):
--    lo imposta solo il DB, così il badge non è falsificabile lato client.
CREATE OR REPLACE FUNCTION public.sync_email_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if new.email_confirmed_at is not null then
    update public.profiles set email_verified = true where id = new.id;
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_email_verified();

-- 4) Se la conferma email è disattivata, l'utente nasce già confermato: copri
--    anche il caso INSERT aggiornando handle_new_user (mantiene il resto
--    invariato: crea il profilo con id/email al primo accesso).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  insert into public.profiles (id, email, email_verified)
  values (new.id, new.email, new.email_confirmed_at is not null)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 5) Esponi il flag nella vista pubblica (le altre colonne restano invariate;
--    counters è già presente per lo "storico" venditore).
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT id, full_name, username, avatar_url, bio, created_at, counters, email_verified
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
