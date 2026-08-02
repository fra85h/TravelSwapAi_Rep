-- ============================================================
-- Impalcatura minima per far girare le migration su un Postgres nudo.
--
-- Le migration danno per scontato l'ambiente Supabase: lo schema `auth` con
-- la tabella degli utenti, la funzione auth.uid(), lo schema `extensions` e i
-- ruoli authenticated/service_role. Su un Postgres appena creato non esiste
-- niente di tutto questo, quindi si ricostruisce QUANTO BASTA — non di più:
-- l'obiettivo è provare le regole che vivono in `public`, non riprodurre
-- Supabase.
--
-- auth.uid() è replicata fedelmente: su Supabase legge il campo "sub" dalle
-- claim del JWT della richiesta. Riproducendola così, nei test basta
--   set local request.jwt.claims = '{"sub":"<uuid>"}'
-- per impersonare un utente, e le funzioni SECURITY DEFINER si comportano
-- esattamente come in produzione invece che in una versione semplificata.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Solo le colonne a cui il nostro schema fa davvero riferimento.
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text,
  -- Usata da 20260721160000 per riportare su profiles se l'email è
  -- confermata: senza, quella migration non si riapplica.
  email_confirmed_at timestamptz
);

-- nullif PRIMA del cast a json: senza claim impostate current_setting
-- restituisce la stringa vuota, e ''::json fallisce con "input string ended
-- unexpectedly" invece di dare semplicemente NULL. Fuori da una richiesta
-- autenticata auth.uid() deve valere NULL, non esplodere.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'role',
    'anon')
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN;
  END IF;
END $$;

-- Supabase espone il realtime tramite una publication chiamata
-- supabase_realtime, a cui alcune migration aggiungono le tabelle di chat e
-- notifiche. Su un Postgres nudo non esiste: si crea vuota, così quelle
-- ALTER PUBLICATION passano. Non serve che il realtime funzioni davvero —
-- qui si provano le regole, non la propagazione degli eventi.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
