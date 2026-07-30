-- ============================================================
-- Threat-modeling fase post-transazione (sezione A, punto 1):
-- report_exchange_problem (20260721210000_exchange_dispute.sql) blocca la
-- conferma impostando disputed_at, ma non esiste NESSUNA RPC per
-- risolvere una disputa una volta aperta (confermato dal commento in
-- 20260729150000_confirm_exchange_blocks_on_dispute.sql): l'unica via
-- d'uscita era annullare con cancel_accepted_offer_any, che ignora del
-- tutto disputed_at e non lascia alcuna traccia della disputa stessa.
--
-- Decisione presa con l'utente: nessun concetto di "ruolo admin" nel DB
-- per ora — un endpoint protetto da secret condiviso (requireAdminSecret,
-- stesso principio di requireCronSecret ma con un secret distinto),
-- chiamabile solo da chi gestisce la piattaforma, non dal client mobile.
--
-- Tre esiti possibili:
--   - 'resume': la disputa era infondata/si è risolta da sola (es. il
--     biglietto è arrivato, era un problema di comunicazione) — si azzera
--     disputed_at/disputed_by/dispute_reason, l'offerta resta 'accepted' e
--     la conferma normale può riprendere.
--   - 'cancel_favor_proposer' / 'cancel_favor_owner': la disputa era
--     fondata — si forza l'annullamento (stessa liberazione annunci di
--     cancel_accepted_offer_any), ma SENZA passare dal controllo
--     "una delle due parti" (è un'azione amministrativa) e SENZA marcare
--     cancelled_by/suspicious_cancel_at (quei campi tracciano annullamenti
--     unilaterali di un utente, non una risoluzione arbitrata: qui la
--     traccia è il fatto stesso che esista una riga di risoluzione).
--     disputed_at/disputed_by/dispute_reason restano intatti come storico
--     di cosa fosse la disputa, anche dopo l'annullamento.
--
-- In entrambi i casi si notificano ENTRAMBE le parti (prima: nessuna
-- notifica esisteva per nessun esito di una disputa).
-- ============================================================

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('offer_received','offer_accepted','offer_declined','new_matches',
                  'listing_ping','listing_question','listing_question_answered',
                  'chain_canceled','offer_cancelled','dispute_resolved'));

CREATE FUNCTION public.resolve_exchange_dispute(
  p_offer_id_text text,
  p_outcome text,
  p_note text DEFAULT NULL
) RETURNS public.offers
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_offer public.offers;
  v_owner uuid;
  v_title text;
  v_note text;
begin
  if p_outcome not in ('resume', 'cancel_favor_proposer', 'cancel_favor_owner') then
    raise exception 'Invalid outcome: %', p_outcome;
  end if;

  select * into v_offer from public.offers where id::text = p_offer_id_text for update;
  if not found then raise exception 'Offer not found'; end if;

  if v_offer.disputed_at is null then
    raise exception 'Offer is not disputed';
  end if;

  select l.user_id, l.title into v_owner, v_title from public.listings l where l.id = v_offer.to_listing_id;
  v_note := nullif(trim(coalesce(p_note, '')), '');

  if p_outcome = 'resume' then
    update public.offers
       set disputed_at = null, disputed_by = null, dispute_reason = null
     where id = v_offer.id;
  else
    update public.listings set status = 'active'
     where id::text in (v_offer.to_listing_id::text, coalesce(v_offer.from_listing_id::text, '____none____'))
       and status = 'reserved';

    update public.offers
       set status = 'cancelled',
           owner_confirmed_at = null,
           proposer_confirmed_at = null,
           cancel_reason = 'dispute_resolved:' || p_outcome || coalesce(': ' || v_note, '')
     where id = v_offer.id;
  end if;

  select * into v_offer from public.offers where id = v_offer.id;

  -- Notifica entrambe le parti dell'esito: prima nessuna notifica esisteva
  -- per nessun esito di una disputa (né in caso di ripresa, né di
  -- annullamento arbitrato).
  insert into public.notifications (user_id, type, title, body, data)
  select uid,
    'dispute_resolved',
    case when p_outcome = 'resume' then 'Contestazione risolta'
         else 'Contestazione risolta: scambio annullato' end,
    case when p_outcome = 'resume' then
      coalesce('La contestazione sulla prenotazione «' || v_title || '» è stata risolta: puoi riprendere la conferma dello scambio.'
               || coalesce(' ' || v_note, ''),
               'La contestazione è stata risolta: puoi riprendere la conferma dello scambio.')
    else
      coalesce('La contestazione sulla prenotazione «' || v_title || '» è stata risolta annullando lo scambio.'
               || coalesce(' ' || v_note, ''),
               'La contestazione è stata risolta annullando lo scambio.')
    end,
    jsonb_build_object('offerId', v_offer.id, 'listingId', v_offer.to_listing_id, 'offerType', v_offer.type, 'outcome', p_outcome)
  from (select v_owner as uid union select v_offer.proposer_id) as parties(uid)
  where uid is not null;

  return v_offer;
end $$;

-- Solo il server (client service-role, dietro requireAdminSecret) deve
-- poterla chiamare: nessun controllo "una delle due parti" al suo interno
-- (è un'azione arbitrata, non un'azione dell'utente), quindi non va MAI
-- esposta come RPC pubblica al client mobile.
REVOKE ALL ON FUNCTION public.resolve_exchange_dispute(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_exchange_dispute(text, text, text) TO service_role;
