-- Feature "Ping": su un annuncio CERCO, chi ha il VENDO corrispondente può
-- segnalarlo al proprietario del CERCO con un link diretto — niente offerta,
-- niente chat, solo un avviso "qualcuno ha quello che cerchi". Antispam via
-- UNIQUE (from_listing_id, to_listing_id): un ping per coppia di annunci.

create table if not exists public.listing_pings (
  id              uuid primary key default gen_random_uuid(),
  from_listing_id uuid not null references public.listings(id) on delete cascade,
  to_listing_id   uuid not null references public.listings(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (from_listing_id, to_listing_id)
);

alter table public.listing_pings enable row level security;

-- Nessuna policy di insert/update/delete per gli utenti finali: il ping lo
-- crea solo il server (service-role), dopo aver validato che from_listing_id
-- sia un VENDO attivo del chiamante e to_listing_id un CERCO attivo altrui —
-- stessa filosofia del backstop DB per le altre regole CERCO/VENDO.
drop policy if exists listing_pings_select_own on public.listing_pings;
create policy listing_pings_select_own on public.listing_pings
  for select using (auth.uid() = sender_id);

create index if not exists listing_pings_sender_idx
  on public.listing_pings (sender_id, created_at desc);

-- Il ping genera anche una notifica in-app al proprietario del CERCO: il tipo
-- 'listing_ping' va aggiunto al CHECK esistente su notifications.type.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('offer_received','offer_accepted','offer_declined','new_matches','listing_ping'));
