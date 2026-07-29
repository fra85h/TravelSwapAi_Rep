-- Messaggio più amichevole quando una proposta (acquisto o scambio) viene
-- rifiutata: prima il body diceva solo "è stata rifiutata", senza alcun
-- invito a riprovare. Tocca solo il ramo "declined" di notify_on_offer():
-- il ramo "accepted" e quello INSERT (offerta ricevuta) restano identici.
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
        case when new.status::text = 'accepted' then
          coalesce('La tua proposta su «' || v_title || '» è stata accettata', 'La tua proposta è stata accettata')
        else
          coalesce('La tua proposta su «' || v_title || '» è stata rifiutata. Non ti scoraggiare: nuove occasioni simili arrivano ogni giorno, riprova! 💪',
                   'La tua proposta è stata rifiutata. Non ti scoraggiare: nuove occasioni simili arrivano ogni giorno, riprova! 💪')
        end,
        jsonb_build_object('offerId', new.id, 'listingId', new.to_listing_id, 'offerType', new.type)
      );
    end if;
    return new;
  end if;

  return new;
end;
$$;
