-- ============================================================
-- Timeout delle proposte (offers) pending: 48 ore.
--
-- Oggi una proposta 'pending' non accettata/rifiutata resta lì per
-- sempre: né chi la manda né chi la riceve ha un termine, e l'annuncio
-- di destinazione resta implicitamente "in trattativa" a tempo
-- indeterminato. Introduciamo una scadenza fissa di 48h dalla creazione
-- (stesso valore già usato per chain_proposals.expires_at, vedi
-- 20260712120000_swap_chains.sql), con lo stesso schema a due livelli
-- già collaudato lì:
--   1) scadenza "pigra": chi tocca una proposta pending scaduta (accept/
--      decline_offer_any, le liste in Attività) la marca 'expired' al
--      volo prima di agire — corretta anche senza alcun cron esterno,
--      che in questo progetto non esiste (vedi nota in swap_chains.sql).
--   2) expire_old_offers(): funzione di manutenzione batch, stesso
--      schema di expire_old_chain_proposals(), per chi vuole comunque
--      agganciarla a un job periodico esterno (vedi anche
--      server/src/routes/offers.js — POST /api/offers/recompute).
-- ============================================================

-- 1) Colonna expires_at. Aggiunta SENZA default per poter backfillare le
--    righe esistenti dal loro created_at (non dall'istante della
--    migration, altrimenti tutte le proposte pending già vecchie
--    scadrebbero solo fra 48h invece che riflettere la loro vera età).
alter table public.offers add column expires_at timestamp with time zone;

update public.offers
   set expires_at = created_at + interval '48 hours'
 where expires_at is null;

alter table public.offers alter column expires_at set default (now() + interval '48 hours');
alter table public.offers alter column expires_at set not null;

-- Query di manutenzione/lazy-expiry filtrano su status='pending' + expires_at:
-- indice parziale, tocca solo le righe che contano.
create index if not exists idx_offers_pending_expires
  on public.offers using btree (expires_at)
  where (status = 'pending'::public.offer_status);

-- 2) Quando una proposta scade, ricomputa lo stato pending della/e
--    listing coinvolte — stesso trattamento già riservato a
--    cancelled/declined.
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
  elsif ns in ('cancelled','declined','expired') then
    -- se una proposta decade, viene annullata o scade, ricomputa lo stato
    -- pending della/e listing coinvolte
    if new.from_listing_id is not null then
      perform public.recompute_listing_pending_state(new.from_listing_id);
    end if;
    perform public.recompute_listing_pending_state(new.to_listing_id);
  end if;
  return null;
end;
$$;

-- 3) Scadenza pigra in accept_offer_any / decline_offer_any: chi prova
--    ad agire su una pending scaduta la marca 'expired' invece di
--    accettarla/rifiutarla — poi il ramo esistente "status <> pending
--    -> return" si occupa del resto senza altre modifiche.
CREATE OR REPLACE FUNCTION public.accept_offer_any(offer_id_text text) RETURNS public.offers
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

  if v_offer.status = 'pending' and v_offer.expires_at < now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    select * into v_offer from public.offers where id = v_offer.id;
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

  if v_offer.type = 'swap' and v_offer.from_listing_id is not null then
    -- SWAP: stato finale immediato per entrambi gli annunci
    update public.listings
       set status = 'swapped'
     where id::text in (v_offer.to_listing_id::text, v_offer.from_listing_id::text);
  else
    -- BUY: annuncio riservato, in attesa di pagamento (-> sold al finalize)
    update public.listings
       set status = 'reserved'
     where id::text = v_offer.to_listing_id::text;
  end if;

  -- registra la/le transazione/i
  if v_offer.type = 'swap' and v_offer.from_listing_id is not null then
    insert into public.transactions (listing_id, seller_id, buyer_id, ttype, price, status)
    values
      (v_offer.to_listing_id,   v_owner,             v_offer.proposer_id, 'swap', null, 'completed'),
      (v_offer.from_listing_id, v_offer.proposer_id, v_owner,             'swap', null, 'completed');
  else
    insert into public.transactions (listing_id, seller_id, buyer_id, ttype, price, status)
    values (v_offer.to_listing_id, v_owner, v_offer.proposer_id, 'sale', v_offer.amount, 'completed');
  end if;

  select * into v_offer from public.offers where id = v_offer.id;
  return v_offer;
end $$;

CREATE OR REPLACE FUNCTION public.decline_offer_any(offer_id_text text) RETURNS public.offers
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

  if v_offer.status = 'pending' and v_offer.expires_at < now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    select * into v_offer from public.offers where id = v_offer.id;
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

-- 4) get_my_pending_offer_any: una pending scaduta non deve più contare
--    come "hai già una proposta in corso" (funzione STABLE, quindi solo
--    lettura: niente scrittura qui, il flag si aggiorna al prossimo
--    accept/decline/list).
CREATE OR REPLACE FUNCTION public.get_my_pending_offer_any(listing_id_text text) RETURNS public.offers
    LANGUAGE sql STABLE
    AS $$
  select o.*
  from public.offers o
  where o.to_listing_id = listing_id_text::uuid
    and o.proposer_id = auth.uid()
    and coalesce(nullif(trim(lower(o.status::text)),''),'x') in ('pending','in_review')
    and o.expires_at >= now()
  order by o.created_at desc
  limit 1;
$$;

-- 5) Liste Attività: espongono expires_at (serve al conto alla rovescia
--    lato client) e auto-scadono le proprie pending scadute prima di
--    leggere, cosi anche senza mai chiamare accept/decline la casella
--    Attività mostra lo stato vero. Il cambio della colonna di ritorno
--    impone DROP+CREATE (CREATE OR REPLACE non permette di cambiare le
--    colonne di una funzione a tabella).
DROP FUNCTION IF EXISTS public.list_incoming_offers_any();
CREATE FUNCTION public.list_incoming_offers_any() RETURNS TABLE(id text, type text, status text, message text, amount numeric, currency text, created_at timestamp with time zone, updated_at timestamp with time zone, expires_at timestamp with time zone, to_listing_id text, from_listing_id text, to_listing_title text, from_listing_title text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  update public.offers o
     set status = 'expired'
   where o.status = 'pending'
     and o.expires_at < now()
     and o.to_listing_id in (select id from public.listings where user_id = auth.uid());

  select
    o.id::text,
    o.type,
    o.status,
    o.message,
    o.amount,
    o.currency,
    o.created_at,
    o.updated_at,
    o.expires_at,
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

DROP FUNCTION IF EXISTS public.list_outgoing_offers_any();
CREATE FUNCTION public.list_outgoing_offers_any() RETURNS TABLE(id text, type text, status text, message text, amount numeric, currency text, created_at timestamp with time zone, updated_at timestamp with time zone, expires_at timestamp with time zone, to_listing_id text, from_listing_id text, to_listing_title text, from_listing_title text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  update public.offers o
     set status = 'expired'
   where o.status = 'pending'
     and o.expires_at < now()
     and o.proposer_id = auth.uid();

  select
    o.id::text,
    o.type,
    o.status,
    o.message,
    o.amount,
    o.currency,
    o.created_at,
    o.updated_at,
    o.expires_at,
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

-- 6) Manutenzione batch (facoltativa: la scadenza pigra sopra è già
--    sufficiente per la correttezza) — stesso schema di
--    expire_old_chain_proposals(), per chi vuole agganciare un cron
--    esterno a /api/offers/recompute.
CREATE FUNCTION public.expire_old_offers() RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  n int;
begin
  update public.offers
    set status = 'expired'
  where status = 'pending'
    and expires_at < now();

  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;
