-- Bug: il contatore "storico" (badge "Con storico" + "Scambi completati" su
-- SellerProfileScreen/ProfileScreen) conta profiles.counters.sold +
-- counters.exchanged, ma refresh_profile_counters cerca listings con
-- status = 'exchanged' — valore che NON VIENE MAI SCRITTO da nessuna parte:
-- ogni punto che conclude uno scambio (after_update_offers_propagate,
-- prima ancora nell'init) imposta sempre status = 'swapped', mai
-- 'exchanged'. Risultato: counters.exchanged è sempre 0, per chiunque, da
-- sempre — uno scambio completato non alza MAI lo storico di nessuno dei
-- due lati, a differenza di una vendita (che usa correttamente 'sold').
--
-- Fix: conta gli stati realmente scritti per uno scambio concluso
-- ('swapped', più gli alias storici 'exchanged'/'traded' già riconosciuti
-- lato client da normStatusKey in lib/listingStatus.js, per sicurezza).
CREATE OR REPLACE FUNCTION public.refresh_profile_counters(p_user uuid) RETURNS void
    LANGUAGE sql
    AS $$
  update public.profiles pr
  set counters = jsonb_build_object(
    'active',    (select count(*) from public.listings l where l.user_id = p_user and l.status='active'),
    'sold',      (select count(*) from public.listings l where l.user_id = p_user and l.status='sold'),
    'exchanged', (select count(*) from public.listings l where l.user_id = p_user and l.status::text in ('swapped','exchanged','traded')),
    'total',     (select count(*) from public.listings l where l.user_id = p_user)
  ),
  updated_at = now()
  where pr.id = p_user;
$$;

-- Backfill: ricalcola subito i contatori di tutti gli utenti con almeno un
-- annuncio 'swapped', così lo storico corretto compare senza aspettare il
-- prossimo insert/update/delete su listings (il trigger esistente
-- trg_listings_counters continua a tenerli aggiornati da qui in avanti).
SELECT public.refresh_profile_counters(u.user_id)
FROM (SELECT DISTINCT user_id FROM public.listings WHERE status::text = 'swapped') AS u;
