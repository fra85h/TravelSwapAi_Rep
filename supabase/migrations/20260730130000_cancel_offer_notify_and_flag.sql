-- ============================================================
-- Threat-modeling fase post-transazione (sezione A, punto 2):
-- cancel_accepted_offer_any() (ultima versione:
-- 20260721190000_two_sided_exchange_confirmation.sql) può essere chiamata
-- da UNA SOLA delle due parti, senza il consenso dell'altra, e:
--   - azzera silenziosamente anche la conferma già data dall'altra parte
--     (owner_confirmed_at/proposer_confirmed_at → null), senza lasciare
--     traccia di chi ha annullato o perché;
--   - non notifica nessuno (notify_on_offer copre solo 'accepted'/
--     'declined', mai 'cancelled' — verificato con grep sull'intero repo).
--
-- Pattern di frode reale che questo abilita: il venditore incassa il
-- pagamento FUORI dall'app (nessun escrow), poi annulla per far sparire
-- ogni prova che l'offerta fosse mai stata accettata/confermata, libero di
-- rivendere lo stesso biglietto a qualcun altro.
--
-- Fix (deciso con l'utente, non rendiamo l'annullamento bilaterale: resta
-- disponibile a una sola parte, serve comunque per i casi legittimi come
-- "l'altro è sparito"):
--   1) registrare SEMPRE chi ha annullato (nuova colonna cancelled_by,
--      stesso schema di disputed_by) e un motivo opzionale (riusa
--      cancel_reason, già esistente per il caso 'listing_unavailable');
--   2) segnalare (SOLO internamente per ora, nessun badge pubblico — se ne
--      riparla quando esisterà un vero processo di risoluzione disputa,
--      vedi punto 1 della stessa analisi) quando l'altra parte aveva GIÀ
--      confermato al momento dell'annullamento: nuova colonna
--      suspicious_cancel_at;
--   3) notificare l'altra parte (prima: silenzio totale).
-- ============================================================

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS suspicious_cancel_at timestamp with time zone;

-- La firma cambia (nuovo parametro reason_text): la vecchia
-- cancel_accepted_offer_any(text) va tolta esplicitamente, altrimenti
-- Postgres la tiene come overload distinto invece di sostituirla.
DROP FUNCTION IF EXISTS public.cancel_accepted_offer_any(text);

CREATE FUNCTION public.cancel_accepted_offer_any(offer_id_text text, reason_text text DEFAULT NULL)
RETURNS public.offers
LANGUAGE plpgsql SECURITY DEFINER
AS $$
declare
  v_offer public.offers;
  v_owner uuid;
  v_is_owner boolean;
  v_other_already_confirmed boolean;
begin
  select * into v_offer from public.offers where id::text = offer_id_text for update;
  if not found then raise exception 'Offer not found'; end if;

  select user_id into v_owner from public.listings where id::text = v_offer.to_listing_id::text;
  if not (v_owner = auth.uid() or v_offer.proposer_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;

  if v_offer.status <> 'accepted' then return v_offer; end if;

  v_is_owner := (v_owner = auth.uid());
  -- Segnale sospetto: l'altra parte (non chi sta annullando ORA) aveva già
  -- dato la sua conferma quando questa viene azzerata dall'annullamento.
  v_other_already_confirmed := case when v_is_owner
    then v_offer.proposer_confirmed_at is not null
    else v_offer.owner_confirmed_at is not null
  end;

  -- Prima riporta gli annunci riservati ad attivi (recompute non tocca
  -- 'reserved'), poi annulla l'offerta.
  update public.listings set status = 'active'
   where id::text in (v_offer.to_listing_id::text, coalesce(v_offer.from_listing_id::text, '____none____'))
     and status = 'reserved';

  update public.offers
     set status = 'cancelled',
         owner_confirmed_at = null,
         proposer_confirmed_at = null,
         cancelled_by = auth.uid(),
         cancel_reason = coalesce(reason_text, cancel_reason),
         suspicious_cancel_at = case when v_other_already_confirmed then now() else null end
   where id = v_offer.id;

  select * into v_offer from public.offers where id = v_offer.id;
  return v_offer;
end $$;

GRANT EXECUTE ON FUNCTION public.cancel_accepted_offer_any(text, text) TO authenticated;

-- notify_on_offer: prima copriva solo 'accepted'/'declined', mai
-- 'cancelled' — nessuno veniva avvisato quando un'offerta accettata veniva
-- annullata. Aggiunto il ramo 'cancelled', che notifica l'ALTRA parte
-- rispetto a chi ha annullato (new.cancelled_by). Il filtro
-- "new.cancelled_by is not null" esclude il cancelOffer() più semplice
-- (proposer_id ritira una propria offerta ancora 'pending', in lib/db.js:
-- non passa mai da cancel_accepted_offer_any, quindi non valorizza mai
-- cancelled_by) — quella è un'azione normale su un'offerta MAI accettata,
-- non riguarda questo fix.
create or replace function public.notify_on_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_notify_user uuid;
begin
  if (tg_op = 'INSERT') then
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
    if new.status::text in ('accepted','declined') and new.proposer_id is not null then
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
    elsif old.status::text = 'accepted' and new.status::text = 'cancelled' and new.cancelled_by is not null then
      select l.user_id, l.title into v_owner, v_title from public.listings l where l.id = new.to_listing_id;
      v_notify_user := case when new.cancelled_by = v_owner then new.proposer_id else v_owner end;
      if v_notify_user is not null then
        insert into public.notifications (user_id, type, title, body, data)
        values (
          v_notify_user,
          'offer_cancelled',
          'Scambio annullato',
          case when new.cancel_reason is not null and new.cancel_reason <> 'listing_unavailable' then
            coalesce('L''altra parte ha annullato lo scambio su «' || v_title || '». Motivo: ' || new.cancel_reason,
                     'L''altra parte ha annullato lo scambio.')
          else
            coalesce('L''altra parte ha annullato lo scambio su «' || v_title || '».',
                     'L''altra parte ha annullato lo scambio.')
          end,
          jsonb_build_object('offerId', new.id, 'listingId', new.to_listing_id, 'offerType', new.type)
        );
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('offer_received','offer_accepted','offer_declined','new_matches',
                  'listing_ping','listing_question','listing_question_answered',
                  'chain_canceled','offer_cancelled'));
