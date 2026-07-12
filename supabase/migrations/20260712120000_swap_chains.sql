-- ============================================================
-- Swap a catena (multi-party chain swap), fase 1: schema + funzioni.
--
-- Generalizza accept_offer_any() (che gestisce solo scambi a 2 lati)
-- a cicli di esattamente 3 utenti: A cede il suo annuncio a B, B cede
-- il suo ad C, C cede il suo ad A. Nessun soldo extra, solo scambio.
--
-- Il ciclo viene TROVATO lato server (fase successiva, fuori da questo
-- file) e proposto qui via create_chain_proposal() — chiamabile solo
-- da service_role, mai dal client. Ogni partecipante deve confermare
-- esplicitamente (confirm_chain_participant); solo quando tutti e 3
-- hanno confermato la catena si chiude atomicamente in una singola
-- transazione, registrando 3 righe in `transactions` (una per lato),
-- riservando i 3 annunci e rifiutando le offerte 1:1 pendenti su di
-- essi — stesso trattamento che accept_offer_any() applica oggi al
-- caso a 2 lati.
--
-- Se un partecipante rifiuta, o se un annuncio non è più `active` nel
-- momento in cui l'ultimo conferma (es. venduto nel frattempo altrove),
-- la catena decade senza toccare nulla: nessuno perde l'annuncio finché
-- non hanno confermato tutti.
-- ============================================================

CREATE TABLE public.chain_proposals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + interval '48 hours') NOT NULL,
    completed_at timestamp with time zone,
    canceled_reason text,
    CONSTRAINT chain_proposals_pkey PRIMARY KEY (id),
    CONSTRAINT chain_proposals_status_check CHECK (status IN ('proposed', 'completed', 'canceled', 'expired'))
);

CREATE TABLE public.chain_participants (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    chain_id uuid NOT NULL,
    "position" smallint NOT NULL,
    user_id uuid NOT NULL,
    give_listing_id uuid NOT NULL,
    receive_listing_id uuid NOT NULL,
    confirmed boolean DEFAULT false NOT NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT chain_participants_pkey PRIMARY KEY (id),
    CONSTRAINT chain_participants_position_check CHECK ("position" IN (0, 1, 2)),
    CONSTRAINT chain_participants_chain_position_key UNIQUE (chain_id, "position"),
    CONSTRAINT chain_participants_chain_user_key UNIQUE (chain_id, user_id),
    CONSTRAINT chain_participants_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.chain_proposals(id) ON DELETE CASCADE,
    CONSTRAINT chain_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT chain_participants_give_listing_id_fkey FOREIGN KEY (give_listing_id) REFERENCES public.listings(id) ON DELETE CASCADE,
    CONSTRAINT chain_participants_receive_listing_id_fkey FOREIGN KEY (receive_listing_id) REFERENCES public.listings(id) ON DELETE CASCADE
);

CREATE INDEX idx_chain_participants_user ON public.chain_participants USING btree (user_id);
CREATE INDEX idx_chain_participants_chain ON public.chain_participants USING btree (chain_id);
CREATE INDEX idx_chain_proposals_status ON public.chain_proposals USING btree (status);

ALTER TABLE public.chain_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chain_participants ENABLE ROW LEVEL SECURITY;

-- Helper SECURITY DEFINER: verifica l'appartenenza a una catena senza
-- ri-attraversare la RLS di chain_participants dall'interno della sua
-- stessa policy (la subquery diretta causerebbe ricorsione infinita,
-- dato che chain_participants_read_same_chain interroga la tabella che
-- sta proteggendo). Essendo di proprietà di postgres, come le tabelle,
-- questa funzione bypassa la RLS internamente.
CREATE FUNCTION public._chain_participant_exists(p_chain_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE
    AS $$
  select exists (
    select 1 from public.chain_participants
    where chain_id = p_chain_id and user_id = p_user_id
  );
$$;

-- Lettura: solo chi partecipa alla catena vede la catena e gli altri
-- partecipanti (deve poter vedere chi gli darà cosa). Nessuna policy di
-- scrittura per authenticated/anon: si scrive solo via le funzioni
-- SECURITY DEFINER sotto, o da service_role (che comunque bypassa RLS).
CREATE POLICY chain_proposals_read_participant ON public.chain_proposals
    FOR SELECT USING ( public._chain_participant_exists(id, auth.uid()) );

CREATE POLICY chain_participants_read_same_chain ON public.chain_participants
    FOR SELECT USING ( public._chain_participant_exists(chain_participants.chain_id, auth.uid()) );

-- ------------------------------------------------------------
-- create_chain_proposal: crea una proposta di catena a partire da un
-- ciclo di 3 (user_id, give_listing_id, receive_listing_id) già
-- trovato lato server. Valida che sia davvero un ciclo chiuso (il
-- receive di ognuno è il give del successivo), che ogni listing sia
-- posseduto da chi dichiara di darlo e sia `active`. Solo service_role
-- può chiamarla: non è una funzione pensata per essere invocata dal
-- client, il client vede solo il risultato tramite le policy di sopra.
-- ------------------------------------------------------------
CREATE FUNCTION public.create_chain_proposal(p_participants jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_chain_id uuid;
  v_row jsonb;
  v_i int;
  v_user_id uuid;
  v_give uuid;
  v_recv uuid;
  v_next_give uuid;
  v_owner uuid;
  v_status public.listing_status;
  v_seen_users uuid[] := '{}'::uuid[];
  v_seen_listings uuid[] := '{}'::uuid[];
begin
  if jsonb_array_length(p_participants) <> 3 then
    raise exception 'A chain proposal requires exactly 3 participants, got %', jsonb_array_length(p_participants);
  end if;

  for v_i in 0..2 loop
    v_row := p_participants -> v_i;
    v_user_id := (v_row->>'user_id')::uuid;
    v_give := (v_row->>'give_listing_id')::uuid;
    v_recv := (v_row->>'receive_listing_id')::uuid;

    if v_user_id = any(v_seen_users) then
      raise exception 'Duplicate user_id % in chain', v_user_id;
    end if;
    v_seen_users := v_seen_users || v_user_id;

    if v_give = any(v_seen_listings) then
      raise exception 'Duplicate listing % in chain', v_give;
    end if;
    v_seen_listings := v_seen_listings || v_give;

    select user_id, status into v_owner, v_status
    from public.listings where id = v_give;

    if v_owner is null then
      raise exception 'Listing % not found', v_give;
    end if;
    if v_owner <> v_user_id then
      raise exception 'Listing % is not owned by %', v_give, v_user_id;
    end if;
    if v_status <> 'active' then
      raise exception 'Listing % is not active', v_give;
    end if;

    v_next_give := ((p_participants -> ((v_i + 1) % 3))->>'give_listing_id')::uuid;
    if v_next_give <> v_recv then
      raise exception 'Chain is not a closed cycle at position %', v_i;
    end if;
  end loop;

  insert into public.chain_proposals default values returning id into v_chain_id;

  for v_i in 0..2 loop
    v_row := p_participants -> v_i;
    insert into public.chain_participants (chain_id, "position", user_id, give_listing_id, receive_listing_id)
    values (
      v_chain_id,
      v_i,
      (v_row->>'user_id')::uuid,
      (v_row->>'give_listing_id')::uuid,
      (v_row->>'receive_listing_id')::uuid
    );
  end loop;

  return v_chain_id;
end $$;

REVOKE ALL ON FUNCTION public.create_chain_proposal(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_chain_proposal(jsonb) TO service_role;

-- ------------------------------------------------------------
-- confirm_chain_participant: il chiamante conferma la propria quota
-- della catena. Se dopo la conferma tutti e 3 hanno confermato, chiude
-- la catena atomicamente (stesso trattamento di accept_offer_any: gli
-- annunci coinvolti passano a `reserved`, le offerte 1:1 pendenti su
-- quegli annunci vengono rifiutate, viene registrata una riga di
-- transazione per lato). Se nel frattempo un annuncio non è più
-- `active`, la catena decade invece di completarsi.
-- ------------------------------------------------------------
CREATE FUNCTION public.confirm_chain_participant(p_chain_id uuid) RETURNS public.chain_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_chain public.chain_proposals;
  v_confirmed_count int;
  v_participant record;
  v_all_active boolean := true;
begin
  if not exists (
    select 1 from public.chain_participants
    where chain_id = p_chain_id and user_id = auth.uid()
  ) then
    raise exception 'Not a participant of this chain';
  end if;

  select * into v_chain from public.chain_proposals where id = p_chain_id for update;

  if v_chain.status = 'proposed' and v_chain.expires_at < now() then
    update public.chain_proposals set status = 'expired' where id = p_chain_id;
    select * into v_chain from public.chain_proposals where id = p_chain_id;
  end if;

  if v_chain.status <> 'proposed' then
    return v_chain;
  end if;

  update public.chain_participants
    set confirmed = true, confirmed_at = now()
  where chain_id = p_chain_id and user_id = auth.uid() and confirmed = false;

  select count(*) into v_confirmed_count
  from public.chain_participants where chain_id = p_chain_id and confirmed = true;

  if v_confirmed_count < 3 then
    select * into v_chain from public.chain_proposals where id = p_chain_id;
    return v_chain;
  end if;

  for v_participant in
    select cp.give_listing_id, l.status as listing_status
    from public.chain_participants cp
    join public.listings l on l.id = cp.give_listing_id
    where cp.chain_id = p_chain_id
  loop
    if v_participant.listing_status <> 'active' then
      v_all_active := false;
    end if;
  end loop;

  if not v_all_active then
    update public.chain_proposals
      set status = 'canceled', canceled_reason = 'listing_no_longer_active'
    where id = p_chain_id;
    select * into v_chain from public.chain_proposals where id = p_chain_id;
    return v_chain;
  end if;

  for v_participant in
    select
      cp.user_id,
      cp.give_listing_id,
      (
        select nxt.user_id from public.chain_participants nxt
        where nxt.chain_id = cp.chain_id and nxt."position" = (cp."position" + 1) % 3
      ) as next_user_id
    from public.chain_participants cp
    where cp.chain_id = p_chain_id
  loop
    update public.listings set status = 'reserved' where id = v_participant.give_listing_id;

    update public.offers
      set status = 'declined'
    where (to_listing_id = v_participant.give_listing_id or from_listing_id = v_participant.give_listing_id)
      and status = 'pending';

    insert into public.transactions (listing_id, seller_id, buyer_id, ttype, price, status)
    values (v_participant.give_listing_id, v_participant.user_id, v_participant.next_user_id, 'swap', null, 'completed');
  end loop;

  update public.chain_proposals
    set status = 'completed', completed_at = now()
  where id = p_chain_id;

  select * into v_chain from public.chain_proposals where id = p_chain_id;
  return v_chain;
end $$;

-- ------------------------------------------------------------
-- decline_chain_participant: il chiamante rifiuta la propria quota.
-- La catena decade subito per tutti (nessuno ha ancora perso nulla,
-- gli annunci non vengono toccati finché non confermano tutti).
-- ------------------------------------------------------------
CREATE FUNCTION public.decline_chain_participant(p_chain_id uuid) RETURNS public.chain_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_chain public.chain_proposals;
begin
  if not exists (
    select 1 from public.chain_participants
    where chain_id = p_chain_id and user_id = auth.uid()
  ) then
    raise exception 'Not a participant of this chain';
  end if;

  select * into v_chain from public.chain_proposals where id = p_chain_id for update;

  if v_chain.status = 'proposed' then
    update public.chain_proposals
      set status = 'canceled', canceled_reason = 'declined_by_participant'
    where id = p_chain_id;
    select * into v_chain from public.chain_proposals where id = p_chain_id;
  end if;

  return v_chain;
end $$;

-- ------------------------------------------------------------
-- expire_old_chain_proposals: manutenzione (da chiamare periodicamente
-- lato server, stesso schema di expire_old_accepted_offers). Nessun
-- trigger automatico: Supabase non ha un cron builtin già configurato
-- in questo progetto.
-- ------------------------------------------------------------
CREATE FUNCTION public.expire_old_chain_proposals() RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  n int;
begin
  update public.chain_proposals
    set status = 'expired'
  where status = 'proposed'
    and expires_at < now();

  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;
