-- ============================================================
-- TravelSwapAI — Schema iniziale (public)
-- Ricostruito dal backup del progetto Supabase originale
-- (dump del 05/10/2025), ripulito da OWNER/ACL.
-- Prerequisito: estensione pgvector (Dashboard → Database → Extensions → vector)
-- ============================================================

-- Impostazioni di sessione (come nel dump pg_dump originale):
-- le funzioni possono referenziare tabelle create piu' avanti nel file
set check_function_bodies = off;
set client_min_messages = warning;

create extension if not exists vector with schema public;

--
-- Name: gender_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.gender_enum AS ENUM (
    'M',
    'F'
);



--
-- Name: listing_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.listing_status AS ENUM (
    'draft',
    'active',
    'paused',
    'sold',
    'exchanged',
    'archived'
);



--
-- Name: listing_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.listing_type AS ENUM (
    'hotel',
    'train'
);



--
-- Name: offer_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.offer_status AS ENUM (
    'pending',
    'accepted',
    'declined',
    'cancelled'
);



--
-- Name: transaction_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.transaction_type AS ENUM (
    'sale',
    'swap'
);



--
-- Name: _norm(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public._norm(s text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select lower(trim(coalesce(s,'')));
$$;



--
-- Name: _test_dollar(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public._test_dollar() RETURNS integer
    LANGUAGE sql
    AS $$
  select 42;
$$;



SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: offers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.offers (
    id bigint NOT NULL,
    from_listing_id uuid,
    to_listing_id uuid NOT NULL,
    status public.offer_status DEFAULT 'pending'::public.offer_status,
    message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    type text,
    proposer_id uuid,
    amount numeric(10,2),
    currency text,
    CONSTRAINT offers_type_check CHECK ((type = ANY (ARRAY['swap'::text, 'buy'::text])))
);



--
-- Name: accept_offer(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.accept_offer(offer_id uuid) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
begin
  select * into v_offer from public.offers where id = offer_id for update;
  if not found then
    raise exception 'Offer not found';
  end if;

  select user_id into v_owner from public.listings where id = v_offer.to_listing_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  if v_offer.status <> 'pending' then
    return v_offer;
  end if;

  update public.offers set status = 'accepted' where id = offer_id;

  update public.offers
     set status = 'declined'
   where to_listing_id = v_offer.to_listing_id
     and id <> offer_id
     and status = 'pending';

  update public.listings set status = 'reserved' where id = v_offer.to_listing_id;

  if v_offer.type = 'swap' and v_offer.from_listing_id is not null then
    update public.listings set status = 'reserved' where id = v_offer.from_listing_id;
  end if;

  select * into v_offer from public.offers where id = offer_id;
  return v_offer;
end $$;



--
-- Name: accept_offer_any(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.accept_offer_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
begin
  select * into v_offer
  from public.offers
  where id::text = offer_id_text
  for update;

  if not found then
    raise exception 'Offer not found';
  end if;

  -- owner del listing destinazione (confronto via testo)
  select user_id into v_owner
  from public.listings
  where id::text = v_offer.to_listing_id::text;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  if v_offer.status <> 'pending' then
    return v_offer;
  end if;

  -- accetta
  update public.offers set status = 'accepted' where id = v_offer.id;

  -- rifiuta le altre pendenti verso lo stesso listing
  update public.offers
     set status = 'declined'
   where to_listing_id::text = v_offer.to_listing_id::text
     and id <> v_offer.id
     and status = 'pending';

  -- riserva listing destinazione
  update public.listings
     set status = 'reserved'
   where id::text = v_offer.to_listing_id::text;

  -- se SWAP, riserva anche il listing offerto
  if v_offer.type = 'swap' and v_offer.from_listing_id is not null then
    update public.listings
       set status = 'reserved'
     where id::text = v_offer.from_listing_id::text;
  end if;

  select * into v_offer from public.offers where id = v_offer.id;
  return v_offer;
end $$;



--
-- Name: after_insert_offers_update_listing(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.after_insert_offers_update_listing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.from_listing_id is not null and _norm(new.type) = 'swap' then
    perform public.recompute_listing_pending_state(new.from_listing_id);
  end if;
  return null;
end;
$$;



--
-- Name: after_update_offers_propagate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.after_update_offers_propagate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  ns text := _norm(new.status);
begin
  if ns = 'accepted' then
    if new.from_listing_id is not null then
      update public.listings set status = 'pending'
      where id in (new.from_listing_id, new.to_listing_id)
        and status in ('active');
    else
      -- offerta BUY: almeno il target diventa pending
      update public.listings set status = 'pending'
      where id = new.to_listing_id and status = 'active';
    end if;
  elsif ns = 'finalized' then
    -- finalizzazione: imposta stati finali
    if _norm(new.type) = 'swap' then
      update public.listings set status = 'swapped' where id in (new.from_listing_id, new.to_listing_id);
    else
      update public.listings set status = 'sold' where id = new.to_listing_id;
      -- se esiste una from_listing, portala a 'sold' solo se business rule lo prevede (qui NO)
    end if;
  elsif ns in ('cancelled','declined') then
    -- se una proposta decade o viene annullata, ricomputa lo stato pending della/e listing coinvolte
    if new.from_listing_id is not null then
      perform public.recompute_listing_pending_state(new.from_listing_id);
    end if;
    perform public.recompute_listing_pending_state(new.to_listing_id);
  end if;
  return null;
end;
$$;



--
-- Name: before_insert_offers_enforce(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.before_insert_offers_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  st_to text;
  st_from text;
  cnt int;
begin
  select status into st_to from public.listings where id = new.to_listing_id;
  if st_to is null then
    raise exception 'Listing target inesistente';
  end if;
  if st_to <> 'active' then
    raise exception 'Puoi proporre solo verso annunci attivi';
  end if;

  if new.from_listing_id is not null then
    select status into st_from from public.listings where id = new.from_listing_id;
    if st_from is null then
      raise exception 'La tua listing (from) non esiste';
    end if;
    if st_from <> 'active' then
      raise exception 'La tua listing deve essere attiva per inviare proposte';
    end if;

    if _norm(new.type) = 'swap' then
      select count(*) into cnt
      from public.offers o
      where o.from_listing_id = new.from_listing_id
        and _norm(o.type) = 'swap'
        and _norm(o.status) in ('pending','in_review');

      if cnt >= 2 then
        raise exception 'Hai già 2 proposte attive da questa listing';
      end if;
    end if;
  end if;

  -- normalizza default status
  if new.status is null then new.status := 'pending'; end if;

  return new;
end;
$$;



--
-- Name: decline_offer(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decline_offer(offer_id uuid) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
begin
  select * into v_offer from public.offers where id = offer_id for update;
  if not found then
    raise exception 'Offer not found';
  end if;

  select user_id into v_owner from public.listings where id = v_offer.to_listing_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  if v_offer.status <> 'pending' then
    return v_offer;
  end if;

  update public.offers set status = 'declined' where id = offer_id;
  select * into v_offer from public.offers where id = offer_id;
  return v_offer;
end $$;



--
-- Name: decline_offer_any(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decline_offer_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
begin
  select * into v_offer
  from public.offers
  where id::text = offer_id_text
  for update;

  if not found then
    raise exception 'Offer not found';
  end if;

  select user_id into v_owner
  from public.listings
  where id::text = v_offer.to_listing_id::text;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  if v_offer.status <> 'pending' then
    return v_offer;
  end if;

  update public.offers set status = 'declined' where id = v_offer.id;

  select * into v_offer from public.offers where id = v_offer.id;
  return v_offer;
end $$;



--
-- Name: expire_old_accepted_offers(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.expire_old_accepted_offers() RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  n int;
begin
  update public.offers
    set status = 'expired'
  where _norm(status) = 'accepted'
    and now() > (coalesce(updated_at, created_at) + interval '3 days');

  -- ripristina annunci coinvolti
  perform public.recompute_listing_pending_state(o.from_listing_id)
    from public.offers o
    where _norm(o.status) = 'expired'
      and now() > (coalesce(o.updated_at, o.created_at) + interval '3 days')
      and o.from_listing_id is not null;

  perform public.recompute_listing_pending_state(o.to_listing_id)
    from public.offers o
    where _norm(o.status) = 'expired'
      and now() > (coalesce(o.updated_at, o.created_at) + interval '3 days');

  get diagnostics n = row_count;
  return coalesce(n,0);
end;
$$;



--
-- Name: expire_old_listings(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.expire_old_listings() RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  n int;
begin
  update public.listings
    set status = 'expired'
  where status = 'active'
    and published_at is not null
    and now() > published_at + interval '30 days'
  returning 1 into n;

  return coalesce(n,0);
end;
$$;



--
-- Name: finalize_offer_any(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.finalize_offer_any(offer_id_text text, mode text) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  oid uuid;
  t text;
begin
  begin
    oid := offer_id_text::uuid;
  exception when others then
    -- prova a risolvere se la colonna è integer
    select id::uuid into oid from public.offers where id::text = offer_id_text limit 1;
  end;

  if oid is null then
    raise exception 'Offerta non trovata';
  end if;

  select type into t from public.offers where id = oid;

  update public.offers set status = 'finalized' where id = oid;

  if _norm(t) = 'swap' or _norm(mode) = 'swap' then
    update public.listings set status = 'swapped'
    where id in (select from_listing_id from public.offers where id = oid
                 union all
                 select to_listing_id from public.offers where id = oid);
  else
    update public.listings set status = 'sold'
    where id in (select to_listing_id from public.offers where id = oid);
  end if;
end;
$$;



--
-- Name: fn_user_top_matches(uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_user_top_matches(p_user_id uuid, p_top_per_listing integer DEFAULT 3) RETURNS TABLE(from_listing_id uuid, to_listing_id uuid, score integer, title text, type text, location text, price numeric, explanation text, model text, updated_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  with ranked as (
    select
      m.*,
      row_number() over (partition by m.from_listing_id order by m.score desc) as rn
    from public.matches m
    join public.listings lf on lf.id = m.from_listing_id
    where lf.user_id = p_user_id
  )
  select
    r.from_listing_id,
    r.to_listing_id,
    r.score,
    lt.title,
    lt.type,
    lt.location,
    lt.price,
    r.explanation,
    r.model,
    r.updated_at
  from ranked r
  join public.listings lt on lt.id = r.to_listing_id and lt.status = 'active'
  where r.rn <= p_top_per_listing;
$$;



--
-- Name: get_my_pending_offer_any(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_my_pending_offer_any(listing_id_text text) RETURNS public.offers
    LANGUAGE sql STABLE
    AS $$
  select o.*
  from public.offers o
  where o.to_listing_id = listing_id_text::uuid
    and o.proposer_id = auth.uid()
    and coalesce(nullif(trim(lower(o.status::text)),''),'x') in ('pending','in_review')
  order by o.created_at desc
  limit 1;
$$;



--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;



--
-- Name: list_incoming_offers_any(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.list_incoming_offers_any() RETURNS TABLE(id text, type text, status text, message text, amount numeric, currency text, created_at timestamp with time zone, updated_at timestamp with time zone, to_listing_id text, from_listing_id text, to_listing_title text, from_listing_title text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  select
    o.id::text,
    o.type,
    o.status,
    o.message,
    o.amount,
    o.currency,
    o.created_at,
    o.updated_at,
    o.to_listing_id::text,
    o.from_listing_id::text,
    tl.title as to_listing_title,
    fl.title as from_listing_title
  from public.offers o
  left join public.listings tl on tl.id::text = o.to_listing_id::text
  left join public.listings fl on fl.id::text = o.from_listing_id::text
  where tl.user_id = auth.uid()
  order by o.created_at desc;
$$;



--
-- Name: list_my_active_listings(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.list_my_active_listings() RETURNS TABLE(id text, title text, type text, location text, route_from text, status text, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  select
    l.id::text, l.title, l.type, l.location, l.route_from, l.status, l.created_at
  from public.listings l
  where l.user_id = auth.uid()
    and l.status = 'active'
  order by l.created_at desc;
$$;



--
-- Name: list_outgoing_offers_any(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.list_outgoing_offers_any() RETURNS TABLE(id text, type text, status text, message text, amount numeric, currency text, created_at timestamp with time zone, updated_at timestamp with time zone, to_listing_id text, from_listing_id text, to_listing_title text, from_listing_title text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  select
    o.id::text,
    o.type,
    o.status,
    o.message,
    o.amount,
    o.currency,
    o.created_at,
    o.updated_at,
    o.to_listing_id::text,
    o.from_listing_id::text,
    tl.title as to_listing_title,
    fl.title as from_listing_title
  from public.offers o
  left join public.listings tl on tl.id::text = o.to_listing_id::text
  left join public.listings fl on fl.id::text = o.from_listing_id::text
  where o.proposer_id = auth.uid()
  order by o.created_at desc;
$$;



--
-- Name: match_listings(public.vector, text, uuid, integer, numeric, numeric, integer, date, date, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.match_listings(p_embedding public.vector, p_type text, p_exclude_id uuid, p_k integer DEFAULT 8, p_min_price numeric DEFAULT 0, p_max_price numeric DEFAULT 999999, p_day_tol integer DEFAULT 7, p_base_check_in date DEFAULT NULL::date, p_base_check_out date DEFAULT NULL::date, p_base_departure date DEFAULT NULL::date) RETURNS TABLE(id uuid, type text, title text, description text, location text, check_in date, check_out date, departure_date date, price numeric, currency text, main_photo_url text, created_at timestamp with time zone, score double precision)
    LANGUAGE sql STABLE
    AS $$
with base as (
  select p_embedding::vector as emb
),
filtered as (
  select *
  from public.listings
  where embedding is not null
    and id <> p_exclude_id
    and type = p_type
    and price between p_min_price and p_max_price
    and (
      (p_type = 'hotel' and (
        (
          p_base_check_in is not null and p_base_check_out is not null
          and check_in is not null and check_out is not null
          and daterange(check_in - p_day_tol, check_out + p_day_tol, '[]')
              && daterange(p_base_check_in, p_base_check_out, '[]')
        )
        or (p_base_check_in is null or p_base_check_out is null)
      ))
      or
      (p_type = 'train' and (
        (
          p_base_departure is not null and departure_date is not null
          and departure_date between (p_base_departure - p_day_tol) and (p_base_departure + p_day_tol)
        )
        or p_base_departure is null
      ))
    )
)
select
  l.id                                    as id,
  l.type                                  as type,
  l.title                                  as title,
  l.description                            as description,
  l.location                               as location,
  l.check_in                               as check_in,
  l.check_out                              as check_out,
  l.departure_date                         as departure_date,
  l.price                                  as price,
  l.currency                               as currency,
  l.main_photo_url                         as main_photo_url,
  l.created_at                             as created_at,
  1 - (l.embedding <=> (select emb from base)) as score
from filtered l
order by l.embedding <=> (select emb from base) asc
limit p_k;
$$;



--
-- Name: on_listing_status_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_listing_status_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if (tg_op = 'INSERT') then
    perform public.refresh_profile_counters(new.user_id);
  elsif (tg_op = 'UPDATE') then
    if (new.user_id <> old.user_id) then
      perform public.refresh_profile_counters(old.user_id);
      perform public.refresh_profile_counters(new.user_id);
    else
      perform public.refresh_profile_counters(new.user_id);
    end if;
  elsif (tg_op = 'DELETE') then
    perform public.refresh_profile_counters(old.user_id);
  end if;
  return null;
end $$;



--
-- Name: recompute_listing_pending_state(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.recompute_listing_pending_state(p_listing uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  cnt_pending int;
  has_accepted int;
  cur_status text;
begin
  -- finalizzati/sold/swapped non si toccano
  select status into cur_status from public.listings where id = p_listing;
  if cur_status in ('sold','swapped') then
    return;
  end if;

  -- offerte accettate (non finalizzate)
  select count(*) into has_accepted
  from public.offers o
  where (o.from_listing_id = p_listing or o.to_listing_id = p_listing)
    and _norm(o.status) = 'accepted';

  if has_accepted > 0 then
    update public.listings set status = 'pending' where id = p_listing and status <> 'pending';
    return;
  end if;

  -- numero di proposte "pendenti" uscenti dalla MIA listing (solo swap, cioè from_listing valorizzata)
  select count(*) into cnt_pending
  from public.offers o
  where o.from_listing_id = p_listing
    and _norm(o.type) = 'swap'
    and _norm(o.status) in ('pending','in_review');

  if cnt_pending >= 2 then
    update public.listings set status = 'pending' where id = p_listing and status <> 'pending';
  else
    -- torna attivo se non scaduto/finalizzato
    update public.listings
      set status = 'active'
      where id = p_listing
        and status in ('pending')
        and (published_at is null or (now() <= published_at + interval '30 days'));
  end if;
end;
$$;



--
-- Name: refresh_profile_counters(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refresh_profile_counters(p_user uuid) RETURNS void
    LANGUAGE sql
    AS $$
  update public.profiles pr
  set counters = jsonb_build_object(
    'active',    (select count(*) from public.listings l where l.user_id = p_user and l.status='active'),
    'sold',      (select count(*) from public.listings l where l.user_id = p_user and l.status='sold'),
    'exchanged', (select count(*) from public.listings l where l.user_id = p_user and l.status='exchanged'),
    'total',     (select count(*) from public.listings l where l.user_id = p_user)
  ),
  updated_at = now()
  where pr.id = p_user;
$$;



--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;



--
-- Name: update_listing_trust_score(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_listing_trust_score() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE public.listings
  SET trust_score = NEW.trust_score
  WHERE id = NEW.listing_id;
  RETURN NEW;
END;
$$;



--
-- Name: ai_import_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_import_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    listing_id uuid,
    source text NOT NULL,
    raw_payload text,
    parsed jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_import_logs_source_check CHECK ((source = ANY (ARRAY['pnr'::text, 'qr'::text])))
);



--
-- Name: fb_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fb_sessions (
    sender_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: listing_ai_scores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.listing_ai_scores (
    id bigint NOT NULL,
    listing_id uuid NOT NULL,
    reliability numeric(5,2) NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: listing_ai_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.listing_ai_scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: listing_ai_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.listing_ai_scores_id_seq OWNED BY public.listing_ai_scores.id;


--
-- Name: listing_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.listing_images (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    listing_id uuid NOT NULL,
    url text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);



--
-- Name: listing_secrets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.listing_secrets (
    listing_id uuid NOT NULL,
    pnr text
);



--
-- Name: listing_translations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.listing_translations (
    listing_id uuid NOT NULL,
    lang text NOT NULL,
    title_translated text,
    description_translated text,
    provider text,
    updated_at timestamp with time zone DEFAULT now()
);



--
-- Name: listings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.listings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    type public.listing_type NOT NULL,
    title text NOT NULL,
    location text NOT NULL,
    check_in date,
    check_out date,
    depart_at timestamp with time zone,
    arrive_at timestamp with time zone,
    is_named_ticket boolean,
    gender public.gender_enum,
    pnr text,
    description text,
    price numeric(10,2) NOT NULL,
    image_url text,
    status public.listing_status DEFAULT 'active'::public.listing_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    start_date date GENERATED ALWAYS AS (
CASE
    WHEN (type = 'hotel'::public.listing_type) THEN check_in
    WHEN (type = 'train'::public.listing_type) THEN ((depart_at AT TIME ZONE 'UTC'::text))::date
    ELSE NULL::date
END) STORED,
    currency text DEFAULT 'EUR'::text NOT NULL,
    route_from text,
    route_to text,
    cerco_vendo text DEFAULT 'VENDO'::text,
    published_at timestamp with time zone DEFAULT now(),
    source text,
    external_id text,
    contact_url text,
    ai_reliability numeric(5,2),
    ai_reliability_expl jsonb,
    ai_reliability_updated_at timestamp with time zone,
    trust_score numeric(5,2),
    CONSTRAINT listings_cerco_vendo_check CHECK ((cerco_vendo = ANY (ARRAY['CERCO'::text, 'VENDO'::text]))),
    CONSTRAINT listings_price_check CHECK ((price >= (0)::numeric))
);



--
-- Name: match_snapshots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.match_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL
);



--
-- Name: matches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.matches (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    from_listing_id uuid NOT NULL,
    to_listing_id uuid NOT NULL,
    score integer NOT NULL,
    dims jsonb,
    explanation text,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    user_id uuid NOT NULL,
    bidirectional boolean DEFAULT false NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT matches_score_check CHECK (((score >= 0) AND (score <= 100)))
);



--
-- Name: offers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.offers ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.offers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    username text,
    avatar_url text,
    bio text,
    counters jsonb DEFAULT jsonb_build_object('active', 0, 'sold', 0, 'exchanged', 0, 'total', 0),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    full_name text,
    phone text,
    prefs jsonb DEFAULT '{}'::jsonb NOT NULL
);



--
-- Name: saved_listings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.saved_listings (
    user_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    listing_id uuid NOT NULL,
    buyer_id uuid,
    seller_id uuid NOT NULL,
    ttype public.transaction_type NOT NULL,
    price numeric(10,2),
    status text DEFAULT 'completed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: trust_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.trust_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    listing_id uuid,
    trust_score smallint NOT NULL,
    flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    suggested_fixes jsonb DEFAULT '[]'::jsonb NOT NULL,
    sub_scores jsonb NOT NULL,
    raw jsonb NOT NULL
);



--
-- Name: v_perfect_matches; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_perfect_matches AS
 SELECT m1.id,
    m1.from_listing_id,
    m1.to_listing_id,
    m1.score,
    m1.dims,
    m1.explanation,
    m1.model,
    m1.created_at
   FROM (public.matches m1
     JOIN public.matches m2 ON (((m2.from_listing_id = m1.to_listing_id) AND (m2.to_listing_id = m1.from_listing_id))));



--
-- Name: v_compatible_matches_60; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_compatible_matches_60 AS
 SELECT m.id,
    m.from_listing_id,
    m.to_listing_id,
    m.score,
    m.dims,
    m.explanation,
    m.model,
    m.created_at
   FROM (public.matches m
     LEFT JOIN public.v_perfect_matches p ON ((p.id = m.id)))
  WHERE ((p.id IS NULL) AND (m.score >= 60));



--
-- Name: v_last_minute; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_last_minute AS
 SELECT id,
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
    pnr,
    description,
    price,
    image_url,
    status,
    created_at,
    updated_at,
    start_date
   FROM public.listings
  WHERE ((status = 'active'::public.listing_status) AND (start_date IS NOT NULL) AND (start_date <= (CURRENT_DATE + '3 days'::interval)));



--
-- Name: v_latest_trustscore; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_latest_trustscore AS
 SELECT t1.listing_id,
    t1.trust_score,
    t1.created_at AS evaluated_at
   FROM (public.trust_audit t1
     JOIN ( SELECT trust_audit.listing_id,
            max(trust_audit.created_at) AS max_created
           FROM public.trust_audit
          GROUP BY trust_audit.listing_id) t2 ON (((t1.listing_id = t2.listing_id) AND (t1.created_at = t2.max_created))));



--
-- Name: v_perfect_matches_80; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_perfect_matches_80 AS
 SELECT id,
    from_listing_id,
    to_listing_id,
    score,
    dims,
    explanation,
    model,
    created_at
   FROM public.v_perfect_matches
  WHERE (score >= 80);



--
-- Name: v_top_matches_per_from; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_top_matches_per_from AS
 SELECT m.from_listing_id,
    m.to_listing_id,
    m.score,
    l.title,
    l.type,
    l.location,
    l.price
   FROM (( SELECT matches.id,
            matches.from_listing_id,
            matches.to_listing_id,
            matches.score,
            matches.dims,
            matches.explanation,
            matches.model,
            matches.created_at,
            matches.updated_at,
            matches.items,
            row_number() OVER (PARTITION BY matches.from_listing_id ORDER BY matches.score DESC) AS rn
           FROM public.matches) m
     JOIN public.listings l ON (((l.id = m.to_listing_id) AND (l.status = 'active'::public.listing_status))))
  WHERE (m.rn <= 3);



--
-- Name: listing_ai_scores id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listing_ai_scores ALTER COLUMN id SET DEFAULT nextval('public.listing_ai_scores_id_seq'::regclass);


--
-- Name: ai_import_logs ai_import_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_import_logs
    ADD CONSTRAINT ai_import_logs_pkey PRIMARY KEY (id);


--
-- Name: fb_sessions fb_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fb_sessions
    ADD CONSTRAINT fb_sessions_pkey PRIMARY KEY (sender_id);


--
-- Name: listing_ai_scores listing_ai_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listing_ai_scores
    ADD CONSTRAINT listing_ai_scores_pkey PRIMARY KEY (id);


--
-- Name: listing_images listing_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listing_images
    ADD CONSTRAINT listing_images_pkey PRIMARY KEY (id);


--
-- Name: listing_secrets listing_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listing_secrets
    ADD CONSTRAINT listing_secrets_pkey PRIMARY KEY (listing_id);


--
-- Name: listing_translations listing_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listing_translations
    ADD CONSTRAINT listing_translations_pkey PRIMARY KEY (listing_id, lang);


--
-- Name: listings listings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);


--
-- Name: match_snapshots match_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_snapshots
    ADD CONSTRAINT match_snapshots_pkey PRIMARY KEY (id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: offers offers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_key UNIQUE (username);


--
-- Name: saved_listings saved_listings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.saved_listings
    ADD CONSTRAINT saved_listings_pkey PRIMARY KEY (user_id, listing_id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: trust_audit trust_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.trust_audit
    ADD CONSTRAINT trust_audit_pkey PRIMARY KEY (id);


--
-- Name: fb_sessions_updated_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fb_sessions_updated_idx ON public.fb_sessions USING btree (updated_at);


--
-- Name: idx_ai_scores_listing; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_scores_listing ON public.listing_ai_scores USING btree (listing_id, created_at DESC);


--
-- Name: idx_listing_secrets_pnr; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_listing_secrets_pnr ON public.listing_secrets USING btree (pnr);


--
-- Name: idx_listings_ai_reliability; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_listings_ai_reliability ON public.listings USING btree (ai_reliability DESC NULLS LAST);


--
-- Name: idx_listings_start_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_listings_start_date ON public.listings USING btree (start_date);


--
-- Name: idx_listings_start_date_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_listings_start_date_status ON public.listings USING btree (start_date, status);


--
-- Name: idx_listings_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_listings_status ON public.listings USING btree (status);


--
-- Name: idx_listings_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_listings_type ON public.listings USING btree (type);


--
-- Name: idx_listings_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_listings_user ON public.listings USING btree (user_id);


--
-- Name: idx_match_snapshots_user_gen; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_match_snapshots_user_gen ON public.match_snapshots USING btree (user_id, generated_at DESC);


--
-- Name: idx_matches_from; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_matches_from ON public.matches USING btree (from_listing_id);


--
-- Name: idx_matches_score; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_matches_score ON public.matches USING btree (score DESC);


--
-- Name: idx_matches_to; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_matches_to ON public.matches USING btree (to_listing_id);


--
-- Name: idx_matches_updated_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_matches_updated_at ON public.matches USING btree (updated_at DESC);


--
-- Name: idx_matches_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_matches_user_id ON public.matches USING btree (user_id);


--
-- Name: idx_offers_from_listing; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_offers_from_listing ON public.offers USING btree (from_listing_id);


--
-- Name: idx_offers_proposer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_offers_proposer ON public.offers USING btree (proposer_id);


--
-- Name: idx_offers_to_listing_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_offers_to_listing_status ON public.offers USING btree (to_listing_id, status);


--
-- Name: idx_tx_buyer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tx_buyer ON public.transactions USING btree (buyer_id);


--
-- Name: idx_tx_listing; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tx_listing ON public.transactions USING btree (listing_id);


--
-- Name: idx_tx_seller; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tx_seller ON public.transactions USING btree (seller_id);


--
-- Name: listings_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX listings_created_idx ON public.listings USING btree (created_at);


--
-- Name: listings_currency_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX listings_currency_idx ON public.listings USING btree (currency);


--
-- Name: listings_route_from_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX listings_route_from_idx ON public.listings USING btree (route_from);


--
-- Name: listings_route_to_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX listings_route_to_idx ON public.listings USING btree (route_to);


--
-- Name: listings_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX listings_status_idx ON public.listings USING btree (status);


--
-- Name: matches_unique_pair; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX matches_unique_pair ON public.matches USING btree (from_listing_id, to_listing_id);


--
-- Name: trust_audit_listing_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX trust_audit_listing_idx ON public.trust_audit USING btree (listing_id);


--
-- Name: trust_audit_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX trust_audit_user_idx ON public.trust_audit USING btree (user_id);


--
-- Name: uq_offers_one_accepted_per_listing; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_offers_one_accepted_per_listing ON public.offers USING btree (to_listing_id) WHERE (status = 'accepted'::public.offer_status);


--
-- Name: uq_offers_one_pending_per_user_listing; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_offers_one_pending_per_user_listing ON public.offers USING btree (to_listing_id, proposer_id) WHERE (status = 'pending'::public.offer_status);


--
-- Name: ux_listings_external; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_listings_external ON public.listings USING btree (source, external_id);


--
-- Name: users on_auth_user_created; Type: TRIGGER; Schema: auth; Owner: supabase_auth_admin
--

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


--
-- Name: offers set_offers_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER set_offers_updated_at BEFORE UPDATE ON public.offers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: offers trg_after_insert_offers_update_listing; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_after_insert_offers_update_listing AFTER INSERT ON public.offers FOR EACH ROW EXECUTE FUNCTION public.after_insert_offers_update_listing();


--
-- Name: offers trg_after_update_offers_propagate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_after_update_offers_propagate AFTER UPDATE OF status ON public.offers FOR EACH ROW EXECUTE FUNCTION public.after_update_offers_propagate();


--
-- Name: offers trg_before_insert_offers_enforce; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_before_insert_offers_enforce BEFORE INSERT ON public.offers FOR EACH ROW EXECUTE FUNCTION public.before_insert_offers_enforce();


--
-- Name: listings trg_listings_counters; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_listings_counters AFTER INSERT OR DELETE OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.on_listing_status_change();


--
-- Name: listings trg_listings_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_listings_updated_at BEFORE UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: trust_audit trg_update_listing_trust_score; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_update_listing_trust_score AFTER INSERT ON public.trust_audit FOR EACH ROW EXECUTE FUNCTION public.update_listing_trust_score();


--
-- Name: ai_import_logs ai_import_logs_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_import_logs
    ADD CONSTRAINT ai_import_logs_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;


--
-- Name: ai_import_logs ai_import_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_import_logs
    ADD CONSTRAINT ai_import_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: listing_ai_scores listing_ai_scores_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listing_ai_scores
    ADD CONSTRAINT listing_ai_scores_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: listing_images listing_images_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listing_images
    ADD CONSTRAINT listing_images_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: listing_secrets listing_secrets_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listing_secrets
    ADD CONSTRAINT listing_secrets_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: listing_translations listing_translations_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listing_translations
    ADD CONSTRAINT listing_translations_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: listings listings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: matches matches_from_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_from_listing_id_fkey FOREIGN KEY (from_listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: matches matches_to_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_to_listing_id_fkey FOREIGN KEY (to_listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: offers offers_from_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_from_listing_id_fkey FOREIGN KEY (from_listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: offers offers_to_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_to_listing_id_fkey FOREIGN KEY (to_listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: saved_listings saved_listings_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.saved_listings
    ADD CONSTRAINT saved_listings_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: saved_listings saved_listings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.saved_listings
    ADD CONSTRAINT saved_listings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: offers Create offer if both listings exist; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Create offer if both listings exist" ON public.offers FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.from_listing_id) AND (l.user_id = auth.uid())))) AND (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE (l.id = offers.to_listing_id)))));


--
-- Name: offers Offers readable to participants; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Offers readable to participants" ON public.offers FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE (((l.id = offers.from_listing_id) OR (l.id = offers.to_listing_id)) AND ((l.user_id = auth.uid()) OR (l.status = 'active'::public.listing_status))))));


--
-- Name: profiles Profiles are selectable by owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Profiles are selectable by owner" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: profiles Profiles are updatable by owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Profiles are updatable by owner" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: listings Public can read active listings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read active listings" ON public.listings FOR SELECT TO authenticated, anon USING ((status = 'active'::public.listing_status));


--
-- Name: listings Public read active listings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public read active listings" ON public.listings FOR SELECT USING ((status = 'active'::public.listing_status));


--
-- Name: profiles Public read profiles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public read profiles" ON public.profiles FOR SELECT USING (true);


--
-- Name: offers Update offer if owner of from_listing; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Update offer if owner of from_listing" ON public.offers FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.from_listing_id) AND (l.user_id = auth.uid())))));


--
-- Name: profiles User can insert/update own profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "User can insert/update own profile" ON public.profiles USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: listings Users can read own listings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can read own listings" ON public.listings FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: listings Users manage own listings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users manage own listings" ON public.listings USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: listings Users read own listings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own listings" ON public.listings FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: ai_import_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_import_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_import_logs ai_logs_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_logs_read_own ON public.ai_import_logs FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: ai_import_logs ai_logs_write_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_logs_write_own ON public.ai_import_logs FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: listing_images; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.listing_images ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_images listing_images_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listing_images_read ON public.listing_images FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_images.listing_id) AND ((l.status <> 'draft'::public.listing_status) OR (l.user_id = auth.uid()))))));


--
-- Name: listing_images listing_images_write_user; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listing_images_write_user ON public.listing_images USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_images.listing_id) AND (l.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_images.listing_id) AND (l.user_id = auth.uid())))));


--
-- Name: listing_secrets; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.listing_secrets ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_translations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.listing_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: listings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

--
-- Name: listings listings_delete_user; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listings_delete_user ON public.listings FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: listings listings_insert_user; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listings_insert_user ON public.listings FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: listings listings_owner_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listings_owner_delete ON public.listings FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: listings listings_owner_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listings_owner_insert ON public.listings FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: listings listings_owner_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listings_owner_read ON public.listings FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: listings listings_owner_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listings_owner_update ON public.listings FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: listings listings_public_read_active; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listings_public_read_active ON public.listings FOR SELECT USING ((status = 'active'::public.listing_status));


--
-- Name: listings listings_read_all_active; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listings_read_all_active ON public.listings FOR SELECT USING (((status = ANY (ARRAY['active'::public.listing_status, 'sold'::public.listing_status, 'exchanged'::public.listing_status, 'paused'::public.listing_status, 'archived'::public.listing_status])) OR (user_id = auth.uid())));


--
-- Name: listings listings_update_user; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY listings_update_user ON public.listings FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: matches; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

--
-- Name: matches matches_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY matches_read_all ON public.matches FOR SELECT USING (true);


--
-- Name: matches matches_write_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY matches_write_owner ON public.matches FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = matches.from_listing_id) AND (l.user_id = auth.uid())))));


--
-- Name: offers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

--
-- Name: offers offers_insert_buy_or_swap_by_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_insert_buy_or_swap_by_owner ON public.offers FOR INSERT WITH CHECK ((((type = 'buy'::text) AND (from_listing_id IS NULL) AND (proposer_id = auth.uid())) OR ((type = 'swap'::text) AND (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.user_id = auth.uid()) AND ((l.id)::text = (offers.from_listing_id)::text)))))));


--
-- Name: offers offers_owner_delete_from; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_owner_delete_from ON public.offers FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.from_listing_id) AND (l.user_id = auth.uid())))));


--
-- Name: offers offers_owner_insert_from; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_owner_insert_from ON public.offers FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.from_listing_id) AND (l.user_id = auth.uid())))));


--
-- Name: offers offers_owner_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_owner_update ON public.offers FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.from_listing_id) AND (l.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.to_listing_id) AND (l.user_id = auth.uid())))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.from_listing_id) AND (l.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.to_listing_id) AND (l.user_id = auth.uid()))))));


--
-- Name: offers offers_read_if_active_or_participant; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_read_if_active_or_participant ON public.offers FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.from_listing_id) AND ((l.user_id = auth.uid()) OR (l.status = 'active'::public.listing_status))))) OR (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.to_listing_id) AND ((l.user_id = auth.uid()) OR (l.status = 'active'::public.listing_status)))))));


--
-- Name: offers offers_select_by_listing_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_select_by_listing_owner ON public.offers FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.to_listing_id) AND (l.user_id = auth.uid())))));


--
-- Name: offers offers_select_by_proposer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_select_by_proposer ON public.offers FOR SELECT TO authenticated USING ((proposer_id = auth.uid()));


--
-- Name: offers offers_select_owner_or_proposer; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_select_owner_or_proposer ON public.offers FOR SELECT USING (((auth.uid() = proposer_id) OR (auth.uid() IN ( SELECT l.user_id
   FROM public.listings l
  WHERE ((l.id)::text = (offers.to_listing_id)::text))) OR (auth.uid() IN ( SELECT l.user_id
   FROM public.listings l
  WHERE ((l.id)::text = (offers.from_listing_id)::text)))));


--
-- Name: offers offers_update_by_listing_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_update_by_listing_owner ON public.offers FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.to_listing_id) AND (l.user_id = auth.uid()))))) WITH CHECK (true);


--
-- Name: offers offers_update_only_proposer_cancel; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY offers_update_only_proposer_cancel ON public.offers FOR UPDATE USING (((proposer_id = auth.uid()) AND (status = 'pending'::public.offer_status))) WITH CHECK ((status = ANY (ARRAY['pending'::public.offer_status, 'cancelled'::public.offer_status])));


--
-- Name: listing_secrets own secrets; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "own secrets" ON public.listing_secrets USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_secrets.listing_id) AND (l.user_id = auth.uid())))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY profiles_read_all ON public.profiles FOR SELECT USING (true);


--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: profiles profiles_upsert_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY profiles_upsert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));


--
-- Name: profiles profiles_upsert_self; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY profiles_upsert_self ON public.profiles USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: listing_translations public read translations; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "public read translations" ON public.listing_translations FOR SELECT USING (true);


--
-- Name: saved_listings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.saved_listings ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_listings saved_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY saved_read_own ON public.saved_listings FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: saved_listings saved_write_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY saved_write_own ON public.saved_listings USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions tx_read_involved; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tx_read_involved ON public.transactions FOR SELECT USING (((seller_id = auth.uid()) OR (buyer_id = auth.uid())));


--
-- Name: transactions tx_write_seller_only; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tx_write_seller_only ON public.transactions FOR INSERT WITH CHECK ((seller_id = auth.uid()));


