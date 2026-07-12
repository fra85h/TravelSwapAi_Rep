-- ============================================================
-- Storico transazioni: registra una riga in `transactions` quando
-- un'offerta viene accettata. Finora nessuna funzione/trigger scriveva
-- mai in questa tabella (esisteva nello schema ma restava vuota).
--
-- Modifica accept_offer_any() (l'unica funzione di accettazione usata
-- dall'app) aggiungendo l'insert in modo atomico con l'accettazione:
-- - offerta 'buy'  -> 1 riga  (ttype='sale', price=amount)
-- - offerta 'swap' -> 2 righe (ttype='swap', una per ciascun annuncio
--   che cambia proprietario) — la funzione e' SECURITY DEFINER e gia'
--   aggiorna lo status di ENTRAMBI gli annunci coinvolti (anche quello
--   dell'utente che non ha chiamato la funzione), quindi puo' scrivere
--   in sicurezza anche la riga con seller_id diverso dal chiamante.
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

  -- registra la/le transazione/i (mai stata scritta automaticamente finora)
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
