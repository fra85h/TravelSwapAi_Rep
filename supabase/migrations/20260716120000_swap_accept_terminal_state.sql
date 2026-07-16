-- ============================================================
-- Stato terminale corretto all'accettazione di un'offerta.
--
-- PROBLEMA: accept_offer_any() portava SEMPRE gli annunci coinvolti a
-- `reserved`, sia per gli scambi sia per gli acquisti. Il passo che li
-- avrebbe portati a `swapped`/`sold` (finalize_offer_any) non viene mai
-- chiamato dall'app, quindi gli annunci restavano bloccati su `reserved`
-- per sempre: sparivano da Esplora (che filtra status='active') ma nel
-- profilo continuavano a comparire come "Attivo" (il badge cadeva nel
-- default) e non venivano conteggiati da nessuna parte.
--
-- DESIGN (predisposto ai pagamenti futuri):
--   • SWAP  -> nessun denaro coinvolto: l'accettazione È la conclusione.
--             Entrambi gli annunci passano subito a `swapped` (finale).
--   • BUY   -> denaro coinvolto: l'annuncio resta `reserved`, cioè
--             "riservato / in attesa di pagamento". Quando in futuro si
--             aggiungerà il flusso pagamenti, alla conferma del pagamento
--             si chiamerà finalize_offer_any() -> `sold`. `reserved` è
--             quindi lo stato "sospeso" voluto, non un bug.
--
-- La funzione è SECURITY DEFINER e aggiorna in sicurezza ENTRAMBI gli
-- annunci (anche quello della controparte), come già faceva prima.
-- ============================================================

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

-- ------------------------------------------------------------
-- Fix una-tantum dei dati esistenti: gli annunci già scambiati (offerta
-- swap accettata) ma rimasti a `reserved` vanno portati a `swapped`.
-- Tocca SOLO gli annunci legati a uno swap accettato, quindi NON altera
-- eventuali `reserved` nati da un acquisto in attesa di pagamento.
-- ------------------------------------------------------------
update public.listings l
   set status = 'swapped'
 where l.status = 'reserved'
   and exists (
     select 1 from public.offers o
     where o.type = 'swap'
       -- confronto come testo: 'finalized' non è (ancora) un valore dell'enum
       -- offer_status, quindi evitiamo la coercizione che darebbe errore 22P02
       and o.status::text in ('accepted', 'finalized')
       and (o.to_listing_id = l.id or o.from_listing_id = l.id)
   );
