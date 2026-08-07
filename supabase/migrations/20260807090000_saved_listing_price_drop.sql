-- 20260807090000_saved_listing_price_drop.sql
--
-- "Il prezzo è sceso" detto a chi l'annuncio l'ha SALVATO.
--
-- Il decadimento automatico del prezzo generava già una notifica
-- 'listing_price_dropped', ma il destinatario era listings.user_id — cioè il
-- venditore, che il prezzo l'ha abbassato lui e non ha bisogno che glielo si
-- dica. Chi aveva messo la stellina proprio perché lo trovava caro non
-- riceveva niente: i preferiti erano un segnalibro muto.
--
-- Due cose, entrambe piccole:
--
-- 1) un nuovo tipo di notifica. NON si riusa 'listing_price_dropped': sono
--    due eventi diversi per due persone diverse ("il tuo annuncio è sceso"
--    contro "un annuncio che segui è sceso"), e tenerli distinti è ciò che
--    permette di dargli icona, testo e — un domani — un interruttore
--    separato in impostazioni.
--
-- 2) una colonna che ricorda a quale prezzo abbiamo avvisato l'ultima volta.
--    Serve contro lo spam: il cron gira spesso e la curva scende a piccoli
--    passi, quindi senza memoria si manderebbe una notifica per ogni
--    centesimo. Con questa, si avvisa solo quando il prezzo è sceso di una
--    percentuale significativa DA QUELL'ULTIMO ANNUNCIO.
--
--    Sta su listings e non su una tabella a parte di proposito: il cron
--    legge già questa riga e la aggiorna già, quindi il controllo anti-spam
--    non costa nemmeno una query in più.

-- ------------------------------------------------------------
-- 1) La memoria dell'ultimo avviso.
-- ------------------------------------------------------------
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS savers_notified_price numeric(10,2);

COMMENT ON COLUMN public.listings.savers_notified_price IS
  'Prezzo a cui è stata mandata l''ultima notifica di ribasso a chi ha salvato l''annuncio. NULL = mai avvisati. Serve a non mandare una notifica per ogni passo del decadimento automatico.';

-- ------------------------------------------------------------
-- 2) Il nuovo tipo di notifica.
--
-- Base: 20260802180000_expire_offers_with_listing_and_notify.sql, la
-- versione cronologicamente più recente del vincolo (14 tipi). Ripartire da
-- una versione precedente farebbe sparire i tipi aggiunti dopo, e siccome
-- l'ALTER valida anche le righe GIÀ presenti fallirebbe con 23514 su
-- notifiche che esistono davvero — è la trappola descritta in CLAUDE.md,
-- già scattata una volta proprio su questo vincolo.
-- ------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('offer_received','offer_accepted','offer_declined','new_matches',
                  'listing_ping','listing_question','listing_question_answered',
                  'chain_canceled','offer_cancelled','dispute_resolved',
                  'offer_confirm_reminder','offer_rating_reminder',
                  'listing_price_dropped','offer_expired',
                  'saved_listing_price_dropped'));

-- ------------------------------------------------------------
-- 3) Il fan-out legge saved_listings per listing_id, che finora era solo la
--    seconda metà della chiave primaria (user_id, listing_id): utile per
--    "cos'ho salvato io", inutile per "chi ha salvato questo".
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_saved_listings_listing
  ON public.saved_listings (listing_id);
