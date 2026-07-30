-- ============================================================
-- Threat-modeling fase post-transazione (sezione A, punto 5, ultimo dei 5):
-- se 2 partecipanti su 3 confermano una catena e il terzo non risponde né
-- rifiuta esplicitamente, non c'era NESSUNA distinzione/protezione per i
-- due che avevano già confermato (verificato: confirm_chain_participant
-- ritorna semplicemente lo stato corrente se v_confirmed_count < 3, nessun
-- timeout dedicato; alla scadenza delle 48h notify_on_chain_canceled
-- avvisa TUTTI e 3 con lo STESSO messaggio, senza distinguere chi aveva
-- già fatto la sua parte). Chi ha già confermato — e nella vita reale
-- potrebbe aver già iniziato ad accordarsi per la consegna fisica fidandosi
-- della catena — non aveva alcun segnale diverso da un silenzio totale
-- fino alla scadenza.
--
-- Due interventi:
--  1) promemoria PROATTIVO (non solo notifica a cose fatte): quando una
--     catena ha ESATTAMENTE 2/3 conferme e mancano meno di 12h alla
--     scadenza, si avvisa chi non ha ancora confermato (urgenza) E si
--     rassicurano i due che hanno già confermato (sono in attesa, non sono
--     loro il problema) — un solo avviso per catena (reminder_sent_at),
--     agganciato allo stesso cron a 15 minuti già esistente per
--     expire_old_chain_proposals (chiamato da findAndProposeChains).
--  2) messaggio di scadenza differenziato: chi aveva già confermato lo
--     sa esplicitamente nel messaggio finale, invece del testo identico
--     per tutti e 3.
-- ============================================================

ALTER TABLE public.chain_proposals
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamp with time zone;

-- ------------------------------------------------------------
-- 1) Promemoria proattivo. SECURITY DEFINER, nessuno scope auth.uid()
--    (pensata per il cron server-side, stesso schema di
--    expire_old_chain_proposals/release_all_stale_reservations).
-- ------------------------------------------------------------
CREATE FUNCTION public.remind_stale_chain_confirmers() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  r record;
  n int := 0;
begin
  for r in
    select cp.id as chain_id
    from public.chain_proposals cp
    where cp.status = 'proposed'
      and cp.reminder_sent_at is null
      and cp.expires_at > now()
      and cp.expires_at < now() + interval '12 hours'
      and (select count(*) from public.chain_participants where chain_id = cp.id and confirmed) = 2
  loop
    -- Chi non ha ancora confermato: avviso di urgenza.
    insert into public.notifications (user_id, type, title, body, data)
    select
      part.user_id,
      'chain_canceled',
      'Scambio a 3 in attesa della tua conferma',
      'Gli altri due partecipanti hanno già confermato uno scambio a 3 che ti coinvolge: manca solo la tua conferma prima che scada. Dai un''occhiata quando puoi!',
      jsonb_build_object('chainId', r.chain_id)
    from public.chain_participants part
    where part.chain_id = r.chain_id and not part.confirmed;

    -- Chi ha già confermato: rassicurazione, non sono loro ad essere in ritardo.
    insert into public.notifications (user_id, type, title, body, data)
    select
      part.user_id,
      'chain_canceled',
      'Scambio a 3: in attesa dell''ultima conferma',
      'Hai già confermato la tua parte di uno scambio a 3: stiamo aspettando l''ultimo partecipante. Se non conferma in tempo ti avviseremo — non hai nulla da fare per ora.',
      jsonb_build_object('chainId', r.chain_id)
    from public.chain_participants part
    where part.chain_id = r.chain_id and part.confirmed;

    update public.chain_proposals set reminder_sent_at = now() where id = r.chain_id;
    n := n + 1;
  end loop;
  return n;
end $$;

REVOKE ALL ON FUNCTION public.remind_stale_chain_confirmers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remind_stale_chain_confirmers() TO service_role;

-- ------------------------------------------------------------
-- 2) Messaggio di scadenza differenziato: chi aveva già confermato lo sa
--    esplicitamente, invece del testo identico per tutti e 3 (basato
--    sulla versione più recente: 20260729160000_notify_chain_canceled.sql).
-- ------------------------------------------------------------
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
      case when cp.confirmed then
        'Avevi già confermato la tua parte di questo scambio a 3, ma non è andato a buon fine perché un altro partecipante non ha confermato in tempo. Nessun annuncio è stato toccato e non hai fatto nulla di sbagliato: non ti scoraggiare, il sistema ricontrolla automaticamente ogni 15 minuti — il prossimo incastro potrebbe essere già pronto! 💪'
      else
        'Uno scambio a 3 a cui partecipavi non è andato a buon fine. Nessun annuncio è stato toccato: non ti scoraggiare, il sistema ricontrolla automaticamente ogni 15 minuti — il prossimo incastro potrebbe essere già pronto! 💪'
      end,
      jsonb_build_object('chainId', new.id, 'reason', coalesce(new.canceled_reason, new.status))
    from public.chain_participants cp
    where cp.chain_id = new.id
      and cp.user_id is distinct from auth.uid();
  end if;
  return new;
end $$;
