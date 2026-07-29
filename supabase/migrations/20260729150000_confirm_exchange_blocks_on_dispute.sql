-- Bug trovato scrivendo il test funzionale sulla contestazione (checklist
-- manuale, Parte 6, step 24): 20260721210000_exchange_dispute.sql dice
-- esplicitamente nel commento in testa "la conferma viene bloccata per
-- entrambi finché non si risolve", ma NESSUNA delle 3 riscritture di
-- confirm_exchange_any (20260721190000, 20260723130000, 20260726120000, la
-- più recente) controlla mai offers.disputed_at. Una prenotazione
-- contestata poteva quindi essere confermata da entrambe le parti e
-- finalizzarsi normalmente (transactions create, annuncio venduto/
-- scambiato) come se non ci fosse nessuna contestazione in corso.
--
-- Riparte dall'ultima versione (20260726120000_data_integrity_hardening.sql,
-- lock ordinato + backstop v_conflicted): unica modifica, un nuovo guard
-- subito dopo il controllo di stato esistente, stesso idioma "return v_offer
-- senza errore" già usato lì per "questa azione non si applica ora".
--
-- Nota per chi userà questa funzione in futuro: oggi non esiste NESSUNA RPC
-- per "risolvere" una contestazione (disputed_at non viene mai azzerato da
-- nessuna parte del codice) — un'offerta contestata resta bloccata per
-- sempre lato conferma. Resta comunque annullabile con
-- cancel_accepted_offer_any (che non controlla disputed_at e non ne aveva
-- bisogno: annullare libera comunque gli annunci). Se serve un percorso di
-- risoluzione esplicito, è una funzionalità a parte, non aggiunta qui.
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

  -- Fix: una prenotazione contestata resta bloccata per ENTRAMBE le parti
  -- finché la contestazione non si risolve (vedi
  -- 20260721210000_exchange_dispute.sql). Prima non c'era alcun controllo:
  -- la conferma procedeva e finalizzava normalmente nonostante la
  -- contestazione aperta.
  if v_offer.disputed_at is not null then return v_offer; end if;

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
