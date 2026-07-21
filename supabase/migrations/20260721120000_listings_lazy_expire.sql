-- Scadenza pigra degli annunci: un annuncio 'active' con la data del
-- viaggio/soggiorno ormai passata (depart_at per i treni, check_in per gli
-- hotel: un biglietto per un treno già partito, o una prenotazione il cui
-- check-in è già iniziato, non è più azionabile) va marcato 'expired'.
--
-- Nel progetto non esiste un cron (solo migration manuali, vedi CLAUDE.md):
-- la scadenza è quindi lazy, sullo stesso schema già usato per le offerte
-- pending scadute (vedi list_incoming_offers_any/list_outgoing_offers_any in
-- 20260718110001_offers_timeout.sql) — gira quando il proprietario apre i
-- propri annunci (ProfileScreen), non su un batch schedulato.
--
-- Nessun SECURITY DEFINER: gira con i privilegi di chi la invoca e si
-- appoggia alla RLS già esistente su listings (policy listings_owner_update /
-- listings_update_user: "user_id = auth.uid()"), quindi tocca solo le righe
-- dell'utente autenticato che la chiama — nessun rischio di toccare annunci
-- altrui.
--
-- 'expired' è reversibile (come 'paused'): se l'utente modifica le date
-- portandole di nuovo nel futuro, CreateListingScreen rimette l'annuncio
-- 'active' al salvataggio (vedi onPublishOrSave). Il toggle rapido
-- pausa/riprendi di ProfileScreen resta invece escluso apposta per
-- 'expired': non può sapere se le nuove date sono valide, quindi il
-- ripristino passa sempre da lì (editare le date), mai dal toggle.
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
       (type = 'hotel' AND check_in IS NOT NULL AND check_in::date < CURRENT_DATE)
     );
$$;

GRANT EXECUTE ON FUNCTION public.expire_my_stale_listings() TO authenticated;
