-- ============================================================
-- Analisi threat-modeling fase post-transazione (sezione A, punto 4):
-- release_my_stale_reservations() esiste solo con scope auth.uid() (versione
-- più recente: 20260729120000_race_reservations_and_chain_locks.sql) ed è
-- chiamata SOLO dal client (travelswap_ai/travelswapai/screens/
-- AttivitaScreen.js al mount). Se NESSUNA delle due parti di uno scambio
-- riapre l'app dopo la scadenza della prenotazione (7 giorni,
-- reservation_expires_at, vedi 20260721200000_reservation_timeout.sql), gli
-- annunci restano bloccati su 'reserved' indefinitamente: nessun cron
-- server-side copre oggi questo caso (expire_old_offers copre solo le
-- offerte 'pending' scadute, non le 'accepted' con prenotazione scaduta).
--
-- Fix: versione batch non filtrata per auth.uid(), stesso schema di
-- expire_old_offers()/expire_old_chain_proposals() — pensata per essere
-- chiamata da /api/offers/recompute (già protetto da requireCronSecret,
-- già usato per expire_old_offers), non dal client mobile.
--
-- Corpo copiato da release_my_stale_reservations() (versione più recente,
-- col fix del lock FOR UPDATE prima di scrivere), tolto solo il filtro
-- "and (o.proposer_id = auth.uid() or tl.user_id = auth.uid())" per
-- coprire TUTTI gli utenti, non solo chi è loggato.
-- ============================================================

CREATE FUNCTION public.release_all_stale_reservations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  r record;
  v_offer public.offers;
  n int := 0;
begin
  for r in
    select o.id, o.to_listing_id, o.from_listing_id
    from public.offers o
    where o.status = 'accepted'
      and o.reservation_expires_at is not null
      and o.reservation_expires_at < now()
  loop
    -- Stesso fix di release_my_stale_reservations: rilegge e blocca la riga
    -- PRIMA di scrivere, altrimenti una finalizzazione concorrente
    -- (confirm_exchange_any) può committare 'finalized' dopo lo snapshot.
    select * into v_offer from public.offers where id = r.id for update;
    if v_offer.status <> 'accepted' then
      continue;
    end if;

    update public.listings set status = 'active'
     where id in (r.to_listing_id, coalesce(r.from_listing_id, r.to_listing_id))
       and status = 'reserved';

    update public.offers
       set status = 'cancelled', owner_confirmed_at = null, proposer_confirmed_at = null
     where id = v_offer.id
       and status = 'accepted';
    n := n + 1;
  end loop;
  return n;
end $$;

-- Solo il server (client service-role) deve poterla chiamare: opera su
-- TUTTI gli utenti, non va esposta come RPC pubblica al client mobile.
REVOKE ALL ON FUNCTION public.release_all_stale_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_all_stale_reservations() TO service_role;

-- Bug collaterale trovato controllando il pattern giusto per la funzione
-- sopra: expire_old_offers (20260718110001_offers_timeout.sql) non ha MAI
-- avuto un REVOKE/GRANT esplicito, quindi eredita l'EXECUTE di default su
-- PUBLIC di Postgres — in teoria chiamabile con
-- supabase.rpc('expire_old_offers') direttamente dal client (anon/
-- authenticated), bypassando del tutto il secret di requireCronSecret lato
-- Express. Impatto pratico basso (tocca solo offerte già scadute da sole),
-- ma è la stessa disattenzione che qui vogliamo evitare: chiuso anche per
-- coerenza con expire_old_chain_proposals, che il GRANT a service_role ce
-- l'ha già.
REVOKE ALL ON FUNCTION public.expire_old_offers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_old_offers() TO service_role;
