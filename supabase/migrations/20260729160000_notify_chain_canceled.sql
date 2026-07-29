-- Empatia mancante quando uno scambio a 3 decade: listMyChainProposals()
-- (travelswap_ai/travelswapai/lib/chains.js) filtra solo status='proposed',
-- quindi quando la catena passa a 'canceled' (uno rifiuta, o un annuncio non
-- è più disponibile al momento della terza conferma — vedi
-- decline_chain_participant / confirm_chain_participant) o 'expired'
-- (nessuno conferma in tempo, expire_old_chain_proposals via cron), la
-- proposta sparisce e basta dalla lista degli ALTRI partecipanti — anche
-- per chi aveva già confermato ed era in attesa. Nessun messaggio, nessuna
-- notifica: stesso gap già corretto per il rifiuto di un'offerta 1:1
-- (20260729130000_friendly_offer_declined_notification.sql, "Non ti
-- scoraggiare...").
--
-- Trigger AFTER UPDATE su chain_proposals (nessuno esisteva finora): fires
-- indipendentemente da quale RPC ha causato il cambio, come notify_on_offer.
-- auth.uid() è null nel contesto del cron di scadenza (nessun utente
-- loggato): "is distinct from" con null è vero per tutti, quindi lì
-- notifica correttamente tutti e 3 i partecipanti allo stesso modo.
--
-- Nuovo tipo 'chain_canceled' nel CHECK di notifications.type (ultima
-- versione del vincolo: 20260726160000_listing_questions.sql).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('offer_received','offer_accepted','offer_declined','new_matches',
                  'listing_ping','listing_question','listing_question_answered',
                  'chain_canceled'));

CREATE OR REPLACE FUNCTION public.notify_on_chain_canceled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if (tg_op = 'UPDATE') and (new.status is distinct from old.status)
     and new.status in ('canceled', 'expired') then
    insert into public.notifications (user_id, type, title, body, data)
    select
      cp.user_id,
      'chain_canceled',
      'Scambio a 3 non riuscito',
      'Uno scambio a 3 a cui partecipavi non è andato a buon fine. Nessun annuncio è stato toccato: non ti scoraggiare, il sistema ricontrolla automaticamente ogni 15 minuti — il prossimo incastro potrebbe essere già pronto! 💪',
      jsonb_build_object('chainId', new.id, 'reason', coalesce(new.canceled_reason, new.status))
    from public.chain_participants cp
    where cp.chain_id = new.id
      and cp.user_id is distinct from auth.uid();
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS after_chain_proposal_canceled ON public.chain_proposals;
CREATE TRIGGER after_chain_proposal_canceled
  AFTER UPDATE ON public.chain_proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_chain_canceled();
