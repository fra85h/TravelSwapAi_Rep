-- ============================================================
-- TravelSwapAI — Hardening di sicurezza dello schema
-- Corregge i problemi rilevati nell'audit (docs/FUNCTIONAL_OVERVIEW.md):
--  1. quattro tabelle senza RLS accessibili con la anon key
--  2. la vista v_last_minute esponeva il PNR pubblicamente
--  3. il PNR viveva anche in listings (va solo in listing_secrets)
--  4. l'enum listing_status non conteneva 'expired'/'deleted',
--     usati sia dal codice sia dalla funzione expire_old_listings()
-- ============================================================

-- 1) Tabelle a uso esclusivo del server (service role bypassa RLS):
--    abilita RLS senza policy = nessun accesso con anon/authenticated
alter table public.fb_sessions enable row level security;
alter table public.listing_ai_scores enable row level security;
alter table public.match_snapshots enable row level security;
alter table public.trust_audit enable row level security;

revoke all on table public.fb_sessions from anon, authenticated;
revoke all on table public.listing_ai_scores from anon, authenticated;
revoke all on table public.match_snapshots from anon, authenticated;
revoke all on table public.trust_audit from anon, authenticated;

-- 2) v_last_minute senza PNR (la vista è leggibile pubblicamente)
drop view if exists public.v_last_minute;
create view public.v_last_minute as
 select id,
    user_id,
    type,
    title,
    location,
    check_in,
    check_out,
    depart_at,
    arrive_at,
    is_named_ticket,
    gender,
    description,
    price,
    image_url,
    status,
    created_at,
    updated_at,
    start_date
   from public.listings
  where status = 'active'::public.listing_status
    and start_date is not null
    and start_date <= (current_date + interval '3 days');

-- 3) PNR solo in listing_secrets: migra i valori residui e rimuovi la colonna
insert into public.listing_secrets (listing_id, pnr)
  select id, pnr from public.listings where pnr is not null
  on conflict (listing_id) do update set pnr = excluded.pnr;

alter table public.listings drop column if exists pnr;

-- 4) Stati mancanti usati da codice e funzioni DB
alter type public.listing_status add value if not exists 'expired';
alter type public.listing_status add value if not exists 'deleted';
