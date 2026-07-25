-- ============================================================
-- Integrità e coerenza dei dati: 12 correzioni emerse dall'audit.
--
-- Ogni funzione riscritta qui parte dalla versione cronologicamente più
-- recente presente in questa cartella, non da init.sql:
--   update_listing_trust_score            -> 20260724120000
--   sync_pnr_fingerprint                  -> 20260721220000
--   enforce_active_listing_cap            -> 20260723110000
--   before_insert_listings_block_duplicate-> 20260721150000
--   accept_offer_any / confirm_exchange_any -> 20260723130000
-- ============================================================


-- ------------------------------------------------------------
-- 1) Trigger di sistema contro il lock degli annunci conclusi
--
-- before_update_listings_lock_terminal blocca QUALUNQUE modifica a un
-- annuncio sold/swapped/exchanged/traded. Due trigger di sistema scrivono su
-- listings senza sapere nulla di quel lock, e quando incrociano un annuncio
-- concluso fanno esplodere l'operazione che li ha innescati:
--
--   update_listing_trust_score  un Check AI su un annuncio già venduto
--                               abortiva l'INSERT su trust_audit
--   sync_pnr_fingerprint        toccare listing_secrets di un annuncio
--                               concluso sollevava l'eccezione, quindi il
--                               PNR di un biglietto venduto non era più
--                               cancellabile
--
-- La soluzione NON è aprire una finestra di bypass: per un annuncio concluso
-- entrambe le sincronizzazioni sono semplicemente inutili. Il punteggio di
-- affidabilità di un annuncio venduto non serve a nessuno, e l'indice
-- ux_listings_live_pnr copre solo gli stati vivi (active/pending/reserved/
-- paused), quindi il fingerprint di un annuncio concluso non vincola nulla.
-- Si salta la propagazione e si lascia passare l'operazione originale.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_listing_trust_score() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_status text;
BEGIN
  -- niente da propagare per gli audit non legati a un annuncio (listing_id
  -- nullo: il Check AI lanciato prima che l'annuncio esista)
  IF NEW.listing_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(status::text) INTO v_status
  FROM public.listings WHERE id = NEW.listing_id;

  -- annuncio inesistente (audit orfano) o già concluso: nessuna scrittura.
  IF v_status IS NULL OR v_status IN ('sold', 'swapped', 'exchanged', 'traded') THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.sync_trust_score', 'on', true);
  UPDATE public.listings
  SET trust_score = NEW.trust_score
  WHERE id = NEW.listing_id;
  PERFORM set_config('app.sync_trust_score', 'off', true);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_pnr_fingerprint()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_listing_id uuid;
  v_status text;
begin
  -- OLD e NEW non sono entrambi assegnati in ogni operazione: si legge solo
  -- quello che esiste, senza scorciatoie con CASE su un record non assegnato.
  if tg_op = 'DELETE' then
    v_listing_id := old.listing_id;
  else
    v_listing_id := new.listing_id;
  end if;

  select lower(status::text) into v_status from public.listings where id = v_listing_id;

  -- Annuncio concluso: l'indice ux_listings_live_pnr non lo considera, quindi
  -- allineare il fingerprint non serve — e proverebbe a scrivere su una riga
  -- bloccata da before_update_listings_lock_terminal.
  if v_status is null or v_status in ('sold', 'swapped', 'exchanged', 'traded') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    update public.listings set pnr_fingerprint = null where id = old.listing_id;
    return old;
  else
    update public.listings set pnr_fingerprint = public.pnr_fingerprint(new.pnr) where id = new.listing_id;
    return new;
  end if;
end $$;


-- ------------------------------------------------------------
-- 2) Race sui controlli "conta-poi-inserisci"
--
-- Due trigger decidono leggendo lo stato corrente e scrivendo subito dopo,
-- senza alcun lock: due richieste concorrenti dello STESSO utente (doppio
-- click, retry di rete, due dispositivi) leggono entrambe una situazione
-- ancora lecita e passano entrambe.
--   enforce_active_listing_cap             count(*) -> si superano i 10 attivi
--   before_insert_listings_block_duplicate exists() -> nasce il duplicato
--                                          che il trigger doveva impedire
--
-- Un lock di riga non basta: le righe in conflitto non esistono ancora. Serve
-- un lock sull'UTENTE, che è l'ambito del vincolo. pg_advisory_xact_lock si
-- libera da solo a fine transazione (commit o rollback) e i due trigger usano
-- la STESSA chiave, quindi si serializzano fra loro senza potersi bloccare a
-- vicenda (gli advisory lock sono rientranti nella stessa transazione).
--
-- Il lock si prende DENTRO l'if, solo quando il controllo va davvero
-- eseguito: le transizioni di sistema (reserved->active di
-- release_my_stale_reservations o di confirm_exchange_any) non lo toccano,
-- così non si crea mai un'attesa incrociata con i lock di riga presi da
-- accept_offer_any.
--
-- 915001 / 915002 sono le due metà della chiave: la prima è un namespace
-- costante per non collidere con altri advisory lock del progetto.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_active_listing_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_count int;
  cap constant int := 10;
BEGIN
  IF new.status = 'active'
     AND (tg_op = 'INSERT' OR old.status::text IN ('paused', 'expired'))
  THEN
    PERFORM pg_advisory_xact_lock(915001, hashtext(new.user_id::text));

    SELECT count(*) INTO active_count
    FROM public.listings
    WHERE user_id = new.user_id
      AND status = 'active'
      AND id <> new.id;
    IF active_count >= cap THEN
      RAISE EXCEPTION 'active listing cap reached (max % attivi) for user %', cap, new.user_id;
    END IF;
  END IF;
  RETURN new;
END;
$$;

-- Il controllo anti-duplicato vale ora anche in UPDATE, ma SOLO sulle stesse
-- transizioni volontarie coperte dal tetto agli attivi (paused/expired ->
-- active). Estenderlo a ogni ritorno ad 'active' romperebbe le transizioni di
-- sistema: confirm_exchange_any riporta ad 'active' il lato non concluso di
-- uno scambio annullato, e release_my_stale_reservations libera le
-- prenotazioni scadute — bloccarle lascerebbe l'annuncio incastrato in uno
-- stato intermedio senza via d'uscita.
CREATE OR REPLACE FUNCTION public.before_insert_listings_block_duplicate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status::text in ('paused', 'expired'))
  then
    perform pg_advisory_xact_lock(915001, hashtext(new.user_id::text));

    if exists (
      select 1
      from public.listings l
      where l.user_id = new.user_id
        and l.id <> new.id
        and l.status = 'active'
        and l.type = new.type
        and coalesce(l.price, -1) = coalesce(new.price, -1)
        and (
          (new.type = 'train'
            and lower(coalesce(l.route_from, '')) = lower(coalesce(new.route_from, ''))
            and lower(coalesce(l.route_to, ''))   = lower(coalesce(new.route_to, ''))
            and l.depart_at is not distinct from new.depart_at)
          or
          (new.type = 'hotel'
            and lower(coalesce(l.location, '')) = lower(coalesce(new.location, ''))
            and l.check_in is not distinct from new.check_in)
        )
    ) then
      raise exception 'duplicate active listing for user %', new.user_id
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_listings_block_duplicate ON public.listings;
CREATE TRIGGER trg_listings_block_duplicate
  BEFORE INSERT OR UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.before_insert_listings_block_duplicate();


-- ------------------------------------------------------------
-- 3) Lock ordinato e lock mancante nelle RPC di scambio
--
-- accept_offer_any blocca i due annunci coinvolti con un solo SELECT ... FOR
-- UPDATE senza ORDER BY: l'ordine di acquisizione dei lock dipende dal piano
-- di scansione, quindi due accettazioni concorrenti sulla STESSA coppia di
-- annunci possono prenderli in ordine opposto e finire in deadlock. Con
-- ORDER BY l.id l'ordine è lo stesso per tutti.
--
-- confirm_exchange_any invece i lock non li prendeva affatto: il controllo
-- "uno dei due annunci è già concluso altrove" leggeva lo stato senza
-- proteggerlo, quindi due conferme concorrenti su offerte che condividono un
-- annuncio passavano entrambe e la seconda incassava proprio l'errore grezzo
-- che quel controllo doveva evitare.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_offer_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
  v_passed boolean;
  v_unavailable boolean;
begin
  select * into v_offer from public.offers where id::text = offer_id_text for update;
  if not found then raise exception 'Offer not found'; end if;

  if v_offer.status = 'pending' and v_offer.expires_at < now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    select * into v_offer from public.offers where id = v_offer.id;
  end if;

  select user_id into v_owner from public.listings where id::text = v_offer.to_listing_id::text;
  if v_owner is null or v_owner <> auth.uid() then raise exception 'Not allowed'; end if;

  if v_offer.status <> 'pending' then return v_offer; end if;

  -- Lock sugli annunci coinvolti PRIMA di leggerne lo stato: se due
  -- accettazioni concorrenti condividono lo stesso from_listing_id, la
  -- seconda aspetta che la prima finisca (commit) invece di leggere uno
  -- stato ormai superato.
  -- ORDER BY l.id: senza un ordine stabile due transazioni possono bloccare
  -- gli stessi due annunci in sequenza opposta e incastrarsi a vicenda.
  perform 1 from public.listings l
  where l.id::text = v_offer.to_listing_id::text
     or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text)
  order by l.id
  for update;

  -- Data del viaggio passata su UNO QUALSIASI degli annunci coinvolti?
  select bool_or(
           (l.type = 'train' and l.depart_at is not null and l.depart_at < now())
        or (l.type = 'hotel' and l.check_in  is not null and l.check_in::date < (now() AT TIME ZONE 'Europe/Rome')::date)
         )
    into v_passed
  from public.listings l
  where l.id::text = v_offer.to_listing_id::text
     or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text);

  if coalesce(v_passed, false) then
    -- niente accettazione: scade l'offerta e marca scaduti gli annunci ancora attivi
    update public.offers set status = 'expired' where id = v_offer.id;
    update public.listings set status = 'expired'
     where id::text in (v_offer.to_listing_id::text, coalesce(v_offer.from_listing_id::text, '____none____'))
       and status = 'active';
    select * into v_offer from public.offers where id = v_offer.id;
    return v_offer;  -- status = 'expired' -> il client mostra "non accettabile"
  end if;

  -- Uno degli annunci coinvolti non è più 'active' (già impegnato in
  -- un'ALTRA proposta accettata nel frattempo): stesso trattamento del
  -- viaggio passato, la proposta non è più valida.
  select bool_or(l.status::text <> 'active')
    into v_unavailable
  from public.listings l
  where l.id::text = v_offer.to_listing_id::text
     or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text);

  if coalesce(v_unavailable, true) then
    update public.offers set status = 'expired' where id = v_offer.id;
    select * into v_offer from public.offers where id = v_offer.id;
    return v_offer;
  end if;

  update public.offers
     set status = 'accepted', reservation_expires_at = now() + interval '7 days'
   where id = v_offer.id;

  update public.offers set status = 'declined'
   where to_listing_id::text = v_offer.to_listing_id::text
     and id <> v_offer.id and status = 'pending';

  if v_offer.type = 'swap' and v_offer.from_listing_id is not null then
    update public.listings set status = 'reserved'
     where id::text in (v_offer.to_listing_id::text, v_offer.from_listing_id::text);
  else
    update public.listings set status = 'reserved'
     where id::text = v_offer.to_listing_id::text;
  end if;

  select * into v_offer from public.offers where id = v_offer.id;
  return v_offer;
end $$;

CREATE OR REPLACE FUNCTION public.confirm_exchange_any(offer_id_text text) RETURNS public.offers
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_offer public.offers;
  v_owner uuid;
  v_is_owner boolean;
  v_conflicted boolean;
begin
  select * into v_offer from public.offers where id::text = offer_id_text for update;
  if not found then raise exception 'Offer not found'; end if;

  select user_id into v_owner from public.listings where id::text = v_offer.to_listing_id::text;

  v_is_owner := (v_owner = auth.uid());
  if not (v_is_owner or v_offer.proposer_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;

  -- Si conferma solo un'offerta accettata e non ancora finalizzata.
  if v_offer.status <> 'accepted' then return v_offer; end if;

  if v_is_owner then
    update public.offers set owner_confirmed_at = coalesce(owner_confirmed_at, now()) where id = v_offer.id;
  else
    update public.offers set proposer_confirmed_at = coalesce(proposer_confirmed_at, now()) where id = v_offer.id;
  end if;
  select * into v_offer from public.offers where id = v_offer.id;

  -- Entrambe confermate -> finalizza (il trigger propaga swapped/sold) e
  -- registra le transazioni 'completed'.
  if v_offer.owner_confirmed_at is not null and v_offer.proposer_confirmed_at is not null then
    -- Lock sugli annunci coinvolti PRIMA di leggerne lo stato: senza, due
    -- conferme concorrenti su offerte che condividono un annuncio leggono
    -- entrambe uno stato non ancora concluso, passano entrambe, e la seconda
    -- fa esplodere before_update_listings_lock_terminal proprio nel momento
    -- della conferma finale. Stesso ORDER BY di accept_offer_any: l'ordine
    -- di acquisizione dev'essere identico ovunque, altrimenti le due RPC
    -- possono bloccarsi a vicenda.
    perform 1 from public.listings l
    where l.id::text = v_offer.to_listing_id::text
       or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text)
    order by l.id
    for update;

    -- Backstop: uno dei due annunci potrebbe essere già concluso altrove
    -- (vedi 20260723130000). Non tentare di riscriverne lo stato: il trigger
    -- before_update_listings_lock_terminal fallirebbe con un errore grezzo
    -- mostrato all'utente proprio ora, alla conferma.
    select bool_or(l.status::text in ('sold','swapped','exchanged','traded'))
      into v_conflicted
    from public.listings l
    where l.id::text = v_offer.to_listing_id::text
       or (v_offer.from_listing_id is not null and l.id::text = v_offer.from_listing_id::text);

    if coalesce(v_conflicted, false) then
      update public.offers
         set status = 'cancelled', cancel_reason = 'listing_unavailable'
       where id = v_offer.id;
      -- libera il lato NON già concluso altrove (l'altro è terminale,
      -- toccarlo fallirebbe comunque per lo stesso motivo).
      update public.listings set status = 'active'
       where (id::text = v_offer.to_listing_id::text
              or (v_offer.from_listing_id is not null and id::text = v_offer.from_listing_id::text))
         and status::text not in ('sold','swapped','exchanged','traded');
      select * into v_offer from public.offers where id = v_offer.id;
      return v_offer;
    end if;

    update public.offers set status = 'finalized' where id = v_offer.id;

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
  end if;

  return v_offer;
end $$;


-- ------------------------------------------------------------
-- 4) trust_score invalidato quando l'annuncio cambia contenuto
--
-- listings.trust_score è denormalizzato da trust_audit e il SOLO a scriverlo
-- è il trigger sull'inserimento di un audit. Nessuno lo azzerava quando
-- l'annuncio veniva modificato, quindi un annuncio riscritto conservava il
-- punteggio calcolato sul testo precedente — le traduzioni invece si
-- invalidano già così (20260717220000).
--
-- Il blocco esisteva solo lato client (contentDirtySinceCheck in
-- CreateListingScreen): una chiamata diretta a PostgREST lasciava il
-- punteggio vecchio su un contenuto nuovo.
--
-- NULL, non zero: "mai verificato" e "verificato male" sono cose diverse, e
-- listActiveListings esclude i NULL da qualunque filtro di affidabilità.
--
-- Il nome del trigger conta: i BEFORE UPDATE su una stessa tabella scattano
-- in ordine alfabetico, e questo DEVE girare dopo trg_listings_lock_columns
-- (che riporta new.trust_score := old.trust_score). "trust" > "lock".
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.before_update_listings_invalidate_trust()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  -- La finestra aperta da update_listing_trust_score è l'unica scrittura
  -- legittima del punteggio: lì il contenuto non cambia, non c'è nulla da
  -- invalidare.
  if coalesce(current_setting('app.sync_trust_score', true), 'off') = 'on' then
    return new;
  end if;

  if new.title        is distinct from old.title
     or new.description is distinct from old.description
     or new.type        is distinct from old.type
     or new.price       is distinct from old.price
     or new.location    is distinct from old.location
     or new.route_from  is distinct from old.route_from
     or new.route_to    is distinct from old.route_to
     or new.depart_at   is distinct from old.depart_at
     or new.arrive_at   is distinct from old.arrive_at
     or new.check_in    is distinct from old.check_in
     or new.check_out   is distinct from old.check_out
     or new.image_url   is distinct from old.image_url
  then
    new.trust_score := null;
  end if;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_listings_trust_invalidate ON public.listings;
CREATE TRIGGER trg_listings_trust_invalidate
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.before_update_listings_invalidate_trust();


-- ------------------------------------------------------------
-- 5) Vincoli che esistevano solo lato client
--
-- Ordine delle date e prezzo positivo erano verificati unicamente da
-- computeErrors in CreateListingScreen: una chiamata diretta a PostgREST
-- inseriva un annuncio con l'arrivo prima della partenza o il prezzo a zero.
--
-- NOT VALID: i vincoli valgono da subito su ogni riga nuova o modificata, ma
-- le righe già presenti non vengono ri-verificate — una migration che
-- fallisce a metà per dati storici è peggio del problema che risolve. Per
-- validare anche lo storico, dopo aver ripulito i dati:
--   ALTER TABLE public.listings VALIDATE CONSTRAINT chk_listings_price_positive;
--
-- Il confronto è stretto (>): partenza e arrivo coincidenti non sono un
-- viaggio, ed è esattamente il caso che passava con l'86% di affidabilità.
-- ------------------------------------------------------------

ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS chk_listings_price_positive;
ALTER TABLE public.listings
  ADD CONSTRAINT chk_listings_price_positive
  CHECK (price > 0) NOT VALID;

ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS chk_listings_hotel_dates_order;
ALTER TABLE public.listings
  ADD CONSTRAINT chk_listings_hotel_dates_order
  CHECK (check_in IS NULL OR check_out IS NULL OR check_out > check_in) NOT VALID;

ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS chk_listings_train_dates_order;
ALTER TABLE public.listings
  ADD CONSTRAINT chk_listings_train_dates_order
  CHECK (depart_at IS NULL OR arrive_at IS NULL OR arrive_at > depart_at) NOT VALID;


-- ------------------------------------------------------------
-- 6) Chiavi esterne mancanti
--
-- Tutte le altre tabelle hanno la FK verso auth.users/listings: queste
-- quattro colonne erano rimaste scoperte, quindi la cancellazione di un
-- utente o di un annuncio lasciava righe orfane che il codice presume
-- collegate.
--
-- NOT VALID per lo stesso motivo dei CHECK: eventuali orfani storici non
-- devono far fallire la migration. Il vincolo vale comunque per le righe
-- nuove, e ON DELETE CASCADE funziona da subito anche senza validazione.
--
-- offers.proposer_id è anche il caso peggiore: nullable e senza vincolo,
-- rendeva inutile l'indice uq_offers_one_pending_per_user_listing
-- (to_listing_id, proposer_id), perché in un indice unico i NULL sono
-- distinti fra loro — con proposer_id nullo si potevano accumulare infinite
-- proposte 'pending' sullo stesso annuncio. Si aggiunge un CHECK invece di
-- NOT NULL per non far fallire la migration su righe storiche.
-- ------------------------------------------------------------

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS offers_proposer_id_fkey;
ALTER TABLE public.offers
  ADD CONSTRAINT offers_proposer_id_fkey
  FOREIGN KEY (proposer_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS chk_offers_proposer_present;
ALTER TABLE public.offers
  ADD CONSTRAINT chk_offers_proposer_present
  CHECK (proposer_id IS NOT NULL) NOT VALID;

ALTER TABLE public.match_snapshots
  DROP CONSTRAINT IF EXISTS match_snapshots_user_id_fkey;
ALTER TABLE public.match_snapshots
  ADD CONSTRAINT match_snapshots_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.trust_audit
  DROP CONSTRAINT IF EXISTS trust_audit_user_id_fkey;
ALTER TABLE public.trust_audit
  ADD CONSTRAINT trust_audit_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.trust_audit
  DROP CONSTRAINT IF EXISTS trust_audit_listing_id_fkey;
ALTER TABLE public.trust_audit
  ADD CONSTRAINT trust_audit_listing_id_fkey
  FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE NOT VALID;


-- ------------------------------------------------------------
-- 7) Ricalcolo dei match: una transazione sola
--
-- recomputeUserSnapshot cancellava i match delle sorgenti e poi li
-- reinseriva a blocchi da 100, con una chiamata PostgREST per blocco: ogni
-- chiamata è una transazione a sé, quindi un errore a metà loop (rete,
-- timeout, riavvio del processo) lasciava l'utente con i match in parte
-- cancellati e in parte ricostruiti, senza modo di accorgersene.
--
-- Qui DELETE e INSERT stanno nello stesso corpo di funzione, cioè nella
-- stessa transazione: o il ricalcolo va a buon fine tutto, o i match
-- precedenti restano intatti.
--
-- p_rows è l'array già pronto lato server. Le colonne omesse (items,
-- generated_at, updated_at) prendono il loro default come prima.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.replace_matches_for_sources(
  p_from_ids uuid[],
  p_rows     jsonb
) RETURNS integer
LANGUAGE plpgsql
AS $$
declare
  v_inserted integer := 0;
begin
  if p_from_ids is null or array_length(p_from_ids, 1) is null then
    return 0;
  end if;

  delete from public.matches where from_listing_id = any(p_from_ids);

  insert into public.matches (
    user_id, from_listing_id, to_listing_id, score,
    bidirectional, model, explanation, created_at
  )
  select
    (r->>'user_id')::uuid,
    (r->>'from_listing_id')::uuid,
    (r->>'to_listing_id')::uuid,
    (r->>'score')::int,
    coalesce((r->>'bidirectional')::boolean, false),
    r->>'model',
    r->>'explanation',
    coalesce((r->>'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  on conflict (from_listing_id, to_listing_id) do update
    set user_id       = excluded.user_id,
        score         = excluded.score,
        bidirectional = excluded.bidirectional,
        model         = excluded.model,
        explanation   = excluded.explanation,
        created_at    = excluded.created_at;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

-- Solo il backend (SERVICE_ROLE) ricalcola i match: nessun GRANT ad
-- anon/authenticated, coerente con la scelta fatta per le altre tabelle
-- server-only in 20260725120000.
REVOKE ALL ON FUNCTION public.replace_matches_for_sources(uuid[], jsonb) FROM public;
