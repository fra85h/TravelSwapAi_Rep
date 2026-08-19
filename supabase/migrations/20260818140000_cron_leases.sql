-- Un giro di manutenzione alla volta.
--
-- I quattro endpoint periodici (/api/chains/recompute,
-- /api/saved-searches/recompute, /api/price-decay/recompute,
-- /api/offers/recompute) non avevano NESSUNA protezione contro le
-- esecuzioni sovrapposte: solo un rate limiter, che conta le richieste ma
-- non sa niente di quelle ancora in corso. Bastano un giro più lento del
-- solito e il successivo che parte a orario — o un doppio crontab, o un
-- riavvio che rilancia il job — e due esecuzioni leggono lo stesso stato,
-- decidono la stessa cosa e la scrivono due volte.
--
-- Il danno concreto già visto nel codice: recomputeDynamicPrices legge
-- savers_notified_price, decide se il ribasso merita un avviso e poi scrive.
-- Fra la lettura e la scrittura non c'è niente che impedisca a un secondo
-- giro di fare lo stesso lavoro, e chi ha salvato l'annuncio riceve due
-- volte la stessa notifica di calo prezzo.
--
-- PERCHÉ UNA TABELLA E NON UN ADVISORY LOCK. pg_advisory_lock è legato alla
-- sessione, e il server parla col database via PostgREST: ogni chiamata è
-- una sessione a sé, che si chiude subito. Un lock di transazione verrebbe
-- rilasciato al ritorno della RPC, cioè prima ancora che il lavoro inizi.
-- Un lease con scadenza invece sopravvive alla singola chiamata, funziona
-- anche con più istanze del server, e se un processo muore a metà giro il
-- turno si libera da solo quando il TTL passa — nessun cron che resta
-- bloccato per sempre per un riavvio andato storto.
--
-- L'atomicità sta tutta nell'ON CONFLICT ... WHERE: Postgres blocca la riga
-- in conflitto, valuta la condizione e aggiorna solo se il lease è scaduto.
-- Due chiamate contemporanee non possono vincere entrambe, e quella che
-- perde non riceve una riga: RETURNING non restituisce niente.

CREATE TABLE IF NOT EXISTS public.cron_leases (
  name        text PRIMARY KEY,
  holder      uuid NOT NULL,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

COMMENT ON TABLE public.cron_leases IS
  'Turno di esecuzione dei job periodici. Una riga per job; chi ce l''ha in mano lavora, gli altri saltano il giro.';

-- Nessuno deve poterla leggere dal client: dice quali lavori girano e
-- quando, e non serve a nessuna schermata. RLS accesa e zero policy = solo
-- il service_role (che la scavalca) ci arriva.
ALTER TABLE public.cron_leases ENABLE ROW LEVEL SECURITY;

/**
 * Prende il turno per `p_name`, se è libero o scaduto.
 * Restituisce il gettone da riconsegnare a fine giro, oppure NULL se il
 * turno è di qualcun altro.
 */
CREATE OR REPLACE FUNCTION public.claim_cron_lease(p_name text, p_ttl_seconds int)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.cron_leases (name, holder, claimed_at, expires_at)
  VALUES (p_name, gen_random_uuid(), now(), now() + make_interval(secs => greatest(p_ttl_seconds, 1)))
  ON CONFLICT (name) DO UPDATE
     SET holder     = excluded.holder,
         claimed_at = excluded.claimed_at,
         expires_at = excluded.expires_at
   WHERE public.cron_leases.expires_at < now()
  RETURNING holder;
$$;

/**
 * Restituisce il turno. Il gettone serve: un giro che ha sforato il TTL ha
 * già perso il turno, e senza questo controllo libererebbe quello di chi sta
 * lavorando adesso — riaprendo esattamente la sovrapposizione che il lease
 * doveva chiudere.
 */
CREATE OR REPLACE FUNCTION public.release_cron_lease(p_name text, p_holder uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH tolto AS (
    DELETE FROM public.cron_leases
     WHERE name = p_name AND holder = p_holder
    RETURNING 1
  )
  SELECT count(*) > 0 FROM tolto;
$$;

-- Solo il server (service_role) gestisce i turni. Le default privileges di
-- Supabase concedono EXECUTE ad anon e authenticated su tutto ciò che nasce
-- in public: qui vanno tolte esplicitamente, altrimenti chiunque abbia la
-- chiave anon potrebbe prendersi il turno di un cron e bloccarlo.
REVOKE ALL ON FUNCTION public.claim_cron_lease(text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cron_lease(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cron_lease(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lease(text, uuid) TO service_role;
