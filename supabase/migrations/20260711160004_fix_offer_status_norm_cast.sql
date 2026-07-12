-- ============================================================
-- Fix critico: _norm(s text) veniva chiamata con offers.status, che è
-- un ENUM (public.offer_status) e non text. Postgres non lo risolve
-- implicitamente per il dispatch di funzione ⇒ ERRORE ogni volta.
--
-- Impatto reale (scoperto testando in locale la migrazione 20260711160003):
-- - after_update_offers_propagate: fallisce ad OGNI cambio di stato di
--   un'offerta ⇒ accept_offer_any / decline_offer_any / updateOffer
--   (cancella offerta) sono TUTTE rotte in produzione oggi.
-- - before_insert_offers_enforce: fallisce quando si crea una nuova
--   offerta di tipo SWAP (verifica del limite "max 2 proposte attive").
-- - expire_old_accepted_offers, recompute_listing_pending_state: rotte
--   se mai invocate (manutenzione/cron).
--
-- offers.type è invece TEXT (non enum): _norm(new.type)/_norm(o.type)
-- erano già corretti e non vengono toccati.
-- ============================================================

CREATE OR REPLACE FUNCTION public.after_update_offers_propagate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  ns text := _norm(new.status::text);
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

CREATE OR REPLACE FUNCTION public.before_insert_offers_enforce() RETURNS trigger
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
        and _norm(o.status::text) in ('pending','in_review');

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

CREATE OR REPLACE FUNCTION public.expire_old_accepted_offers() RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  n int;
begin
  update public.offers
    set status = 'expired'
  where _norm(status::text) = 'accepted'
    and now() > (coalesce(updated_at, created_at) + interval '3 days');

  -- ripristina annunci coinvolti
  perform public.recompute_listing_pending_state(o.from_listing_id)
    from public.offers o
    where _norm(o.status::text) = 'expired'
      and now() > (coalesce(o.updated_at, o.created_at) + interval '3 days')
      and o.from_listing_id is not null;

  perform public.recompute_listing_pending_state(o.to_listing_id)
    from public.offers o
    where _norm(o.status::text) = 'expired'
      and now() > (coalesce(o.updated_at, o.created_at) + interval '3 days');

  get diagnostics n = row_count;
  return coalesce(n,0);
end;
$$;

CREATE OR REPLACE FUNCTION public.recompute_listing_pending_state(p_listing uuid) RETURNS void
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
    and _norm(o.status::text) = 'accepted';

  if has_accepted > 0 then
    update public.listings set status = 'pending' where id = p_listing and status <> 'pending';
    return;
  end if;

  -- numero di proposte "pendenti" uscenti dalla MIA listing (solo swap, cioè from_listing valorizzata)
  select count(*) into cnt_pending
  from public.offers o
  where o.from_listing_id = p_listing
    and _norm(o.type) = 'swap'
    and _norm(o.status::text) in ('pending','in_review');

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
