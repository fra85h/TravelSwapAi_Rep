-- Centro notifiche in-app + predisposizione push nativo.
--
-- Problema: senza push, chi non tiene l'app aperta non sa che è successo
-- qualcosa che lo riguarda (una proposta ricevuta, l'esito della propria
-- proposta, nuovi annunci "Per te"). Il "campanellino" in alto oggi apriva
-- solo gli avvisi di ricerca: mancava un vero centro notifiche.
--
-- Scelta: le notifiche degli EVENTI OFFERTA nascono da un TRIGGER sul DB, non
-- dal client. È la stessa filosofia delle altre regole critiche (coerenza
-- CERCO/VENDO, unicità PNR): la notifica parte qualunque sia il client che ha
-- fatto l'azione, non solo l'app ufficiale. Le notifiche "nuovi match" le crea
-- il server durante la propagazione (deterministica, senza costo AI).

-- ---------------------------------------------------------------------------
-- 1) Tabella notifiche
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null check (type in ('offer_received','offer_accepted','offer_declined','new_matches')),
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,   -- deep-link: { offerId, listingId, ... }
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

-- L'utente legge e aggiorna (segna letto) SOLO le proprie notifiche.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Nessuna policy di INSERT/DELETE per gli utenti finali: le notifiche le
-- creano i trigger (security definer) e la service-role del server.

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;

-- Realtime: badge e lista si aggiornano in tempo reale. La RLS resta valida
-- anche sui payload realtime → ognuno riceve solo le proprie righe.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2) Trigger sugli eventi OFFERTA → notifica
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
begin
  if (tg_op = 'INSERT') then
    -- Proposta ricevuta → avvisa il PROPRIETARIO dell'annuncio target.
    select l.user_id, l.title into v_owner, v_title
      from public.listings l where l.id = new.to_listing_id;
    if v_owner is not null
       and v_owner is distinct from new.proposer_id then
      insert into public.notifications (user_id, type, title, body, data)
      values (
        v_owner,
        'offer_received',
        case when new.type = 'swap' then 'Nuova proposta di scambio'
             else 'Nuova offerta di acquisto' end,
        coalesce('Su «' || v_title || '»', 'Hai ricevuto una proposta'),
        jsonb_build_object('offerId', new.id, 'listingId', new.to_listing_id, 'offerType', new.type)
      );
    end if;
    return new;
  end if;

  if (tg_op = 'UPDATE') and (new.status is distinct from old.status) then
    -- Esito della propria proposta → avvisa il PROPONENTE.
    if new.proposer_id is not null and new.status::text in ('accepted','declined') then
      select l.title into v_title from public.listings l where l.id = new.to_listing_id;
      insert into public.notifications (user_id, type, title, body, data)
      values (
        new.proposer_id,
        case when new.status::text = 'accepted' then 'offer_accepted' else 'offer_declined' end,
        case when new.status::text = 'accepted' then 'Proposta accettata' else 'Proposta rifiutata' end,
        coalesce('La tua proposta su «' || v_title || '»'
                   || case when new.status::text = 'accepted' then ' è stata accettata' else ' è stata rifiutata' end,
                 'Aggiornamento sulla tua proposta'),
        jsonb_build_object('offerId', new.id, 'listingId', new.to_listing_id, 'offerType', new.type)
      );
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists after_offer_notify on public.offers;
create trigger after_offer_notify
  after insert or update on public.offers
  for each row execute function public.notify_on_offer();

-- ---------------------------------------------------------------------------
-- 3) Predisposizione push NATIVO (dormiente finché non c'è un dev build)
--    Il client, su un build nativo, registrerà qui il proprio Expo push token;
--    il server (server/src/lib/push.js) legge questa tabella e invia il push.
--    Su web e finché la tabella è vuota è tutto un no-op: nessun effetto.
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null,
  platform   text,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.push_tokens enable row level security;

drop policy if exists push_tokens_select_own on public.push_tokens;
create policy push_tokens_select_own on public.push_tokens
  for select using (auth.uid() = user_id);

drop policy if exists push_tokens_insert_own on public.push_tokens;
create policy push_tokens_insert_own on public.push_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists push_tokens_update_own on public.push_tokens;
create policy push_tokens_update_own on public.push_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists push_tokens_delete_own on public.push_tokens;
create policy push_tokens_delete_own on public.push_tokens
  for delete using (auth.uid() = user_id);
