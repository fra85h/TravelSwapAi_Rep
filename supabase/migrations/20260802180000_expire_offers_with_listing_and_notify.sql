-- ============================================================
-- Una proposta costruita su un annuncio morto restava viva, e nessuno lo
-- diceva al proponente.
--
-- Segnalato dall'uso reale: proposta in attesa da giorni, la controparte
-- prova ad accettarla e non può perché l'annuncio offerto è scaduto — ma
-- dal lato di chi aveva proposto nessun avviso, e la proposta continuava a
-- comparire in "In attesa" come se fosse ancora in gioco.
--
-- Tre difetti distinti che si sommavano:
--
--   1. expire_my_stale_listings() marcava l'annuncio 'expired' e si
--      fermava lì: le proposte pendenti che lo usavano restavano
--      'pending'. Proposte morte che si presentavano come vive, fino allo
--      scadere delle loro 48 ore o finché qualcuno non provava ad
--      accettarle.
--
--   2. notify_on_offer() copriva 'accepted', 'declined' e 'cancelled', mai
--      'expired'. Nessuna notifica quando una proposta muore — né per
--      scadenza dei 48 ore né perché l'annuncio non c'è più. Nella casella
--      Attività finiva nella sezione "Scadute", che non ha badge.
--
--   3. (lato client, fuori da questa migration) OfferDetailScreen diceva
--      "Proposta accettata" anche quando la RPC aveva restituito 'expired'.
--
-- La RPC accept_offer_any era invece corretta: riconosceva già sia il
-- viaggio passato sia l'annuncio non più attivo. Il buco era tutto
-- attorno, non nella regola.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Il vincolo sui tipi di notifica, PRIMA del trigger che lo usa.
--
-- Non è un dettaglio d'ordine: notify_on_offer è un trigger AFTER, quindi
-- un insert rifiutato dal CHECK farebbe fallire l'INTERA transazione che
-- lo ha scatenato. Aggiungere 'offer_expired' al trigger senza aggiungerlo
-- qui non darebbe una notifica mancante: romperebbe l'accettazione delle
-- proposte in produzione.
--
-- Base: 20260731130000_dynamic_pricing.sql, la versione cronologicamente
-- più recente del vincolo (13 tipi). La prima stesura di questa migration
-- era ripartita da quella dentro 20260730130000 (9 tipi), perdendo
-- 'dispute_resolved', 'offer_confirm_reminder', 'offer_rating_reminder' e
-- 'listing_price_dropped': l'ALTER TABLE valida anche le righe GIÀ
-- presenti, quindi in produzione falliva con 23514 su notifiche che
-- esistevano davvero. È esattamente la trappola descritta in CLAUDE.md,
-- questa volta su un vincolo invece che su una funzione.
-- ------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('offer_received','offer_accepted','offer_declined','new_matches',
                  'listing_ping','listing_question','listing_question_answered',
                  'chain_canceled','offer_cancelled','dispute_resolved',
                  'offer_confirm_reminder','offer_rating_reminder',
                  'listing_price_dropped','offer_expired'));

-- ------------------------------------------------------------
-- 1) expire_my_stale_listings: scade anche le proposte pendenti.
--
-- Base: 20260722140000 (fix fuso orario Europe/Rome), la più recente.
-- L'UPDATE sugli annunci resta identico; si aggiunge il secondo.
--
-- Nessun SECURITY DEFINER, come prima: gira con i privilegi di chi chiama
-- e si appoggia alla RLS esistente. Su offers la policy offers_owner_update
-- permette di aggiornare le proposte che toccano un proprio annuncio (da
-- entrambi i lati, from_listing o to_listing), che è esattamente l'insieme
-- filtrato qui sotto — nessuna proposta altrui viene toccata.
--
-- Quali stati fanno morire una proposta: solo quelli da cui non si torna
-- indietro. 'paused' è ESCLUSO di proposito — mettere in pausa è
-- reversibile, e uccidere le proposte ricevute perché si è messo in pausa
-- un annuncio per un pomeriggio sarebbe un danno, non una pulizia.
-- 'reserved' è escluso per lo stesso motivo: è uno stato temporaneo di una
-- trattativa in corso, e le proposte sorelle le declina già
-- accept_offer_any.
--
-- ::text sui confronti con l'enum: confrontare listing_status con un
-- letterale non presente nell'enum fallisce con 22P02 (vedi CLAUDE.md).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_my_stale_listings()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.listings
     SET status = 'expired'
   WHERE user_id = auth.uid()
     AND status = 'active'
     AND (
       (type = 'train' AND depart_at IS NOT NULL AND depart_at < now())
       OR
       (type = 'hotel' AND check_in IS NOT NULL AND check_in::date < (now() AT TIME ZONE 'Europe/Rome')::date)
     );

  UPDATE public.offers o
     SET status = 'expired'
   WHERE o.status = 'pending'
     AND EXISTS (
       SELECT 1
         FROM public.listings l
        WHERE l.user_id = auth.uid()
          AND l.status::text IN ('expired','deleted','sold','swapped','exchanged','archived')
          AND (l.id = o.to_listing_id OR l.id = o.from_listing_id)
     );
$$;

GRANT EXECUTE ON FUNCTION public.expire_my_stale_listings() TO authenticated;

-- ------------------------------------------------------------
-- 2) notify_on_offer: aggiunto il ramo 'expired'.
--
-- Base: 20260730130000 (ramo 'cancelled'), la più recente. Invariati i
-- rami INSERT, accepted/declined e cancelled.
--
-- Si avvisa il PROPONENTE: è la parte lasciata ad aspettare senza alcun
-- segnale. Il proprietario dell'annuncio non viene avvisato di proposito —
-- nel caso più frequente la proposta muore perché è stato lui a lasciar
-- scadere il proprio annuncio, e dirglielo sarebbe rumore su una cosa che
-- ha appena fatto.
--
-- Il messaggio distingue i due motivi, perché suggeriscono azioni diverse:
-- se l'annuncio non c'è più non ha senso riprovare su quello, se è finito
-- il tempo sì.
-- ------------------------------------------------------------
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
  v_listing_gone boolean;
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

    elsif old.status::text = 'pending' and new.status::text = 'expired' and new.proposer_id is not null then
      select l.title into v_title from public.listings l where l.id = new.to_listing_id;

      -- Perché è morta: annuncio non più disponibile, oppure tempo finito.
      -- Si guardano ENTRAMBI i lati e sia lo stato sia la data del viaggio:
      -- in accept_offer_any il ramo "viaggio già passato" scade l'offerta
      -- PRIMA di marcare gli annunci, quindi al momento di questo trigger
      -- lo stato può ancora essere 'active' mentre la data è passata.
      select bool_or(
               l.status::text <> 'active'
            or (l.type = 'train' and l.depart_at is not null and l.depart_at < now())
            or (l.type = 'hotel' and l.check_in is not null
                and l.check_in::date < (now() AT TIME ZONE 'Europe/Rome')::date)
             )
        into v_listing_gone
      from public.listings l
      where l.id = new.to_listing_id
         or (new.from_listing_id is not null and l.id = new.from_listing_id);

      insert into public.notifications (user_id, type, title, body, data)
      values (
        new.proposer_id,
        'offer_expired',
        'Proposta scaduta',
        case when coalesce(v_listing_gone, false) then
          coalesce('La tua proposta su «' || v_title || '» è scaduta: l''annuncio non è più disponibile. Cerca fra le occasioni simili, ne arrivano di nuove ogni giorno.',
                   'La tua proposta è scaduta: l''annuncio non è più disponibile.')
        else
          coalesce('La tua proposta su «' || v_title || '» è scaduta senza risposta. Puoi riproporla, l''annuncio è ancora lì.',
                   'La tua proposta è scaduta senza risposta.')
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
