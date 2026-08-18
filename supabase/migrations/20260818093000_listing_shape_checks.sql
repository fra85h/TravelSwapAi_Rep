-- Un annuncio deve avere i campi del suo tipo, e solo quelli.
--
-- PERCHÉ SERVE. L'app scrive direttamente su PostgREST: fra la schermata e la
-- tabella non c'è nessun livello server, quindi finora l'unica validazione di
-- forma era quella del client (lib/listingValidation.mjs). Verificato con
-- INSERT diretti su un Postgres reale, oggi entrano senza un lamento:
--   - un 'train' senza tratta e senza date;
--   - un 'hotel' con depart_at e arrive_at valorizzati.
-- Sono righe che nessuna schermata dell'app sa produrre, ma che qualunque
-- altro client può scrivere: una versione vecchia rimasta su un telefono, uno
-- script, una chiamata a mano con la chiave anon. Il danno non è teorico: un
-- treno senza depart_at non scade MAI (expire_my_stale_listings lo salta) e
-- resta acquistabile per sempre; un hotel con depart_at porta due date che si
-- contraddicono nelle stesse colonne da cui il matching ricava la prossimità.
--
-- DUE LIVELLI, DI PROPOSITO.
--
-- 1. I campi dell'ALTRO tipo devono essere NULL, sempre, in qualunque stato.
--    Non esiste un caso legittimo in cui un treno abbia un check-in: è un
--    vincolo che non può respingere niente di buono.
--
-- 2. I campi essenziali sono obbligatori solo per gli annunci VIVI
--    (active/pending/reserved). Un annuncio che si può vedere e su cui si può
--    fare un'offerta deve essere completo; una bozza in pausa, uno scaduto o
--    un'importazione da Messenger finita a metà no. È la stessa soglia che
--    usano già il tetto agli annunci attivi e l'anti-duplicato, e lascia
--    intatte le righe non pubbliche già presenti — senza contare che dà una
--    via d'uscita: una riga incompleta si può sempre mettere in pausa.
--
--    arrive_at è deliberatamente FUORI dall'elenco. Il client lo richiede, ma
--    la sua assenza non rompe niente — nessuna scadenza e nessun match ci si
--    appoggiano — e renderlo obbligatorio spezzerebbe l'importazione da
--    Messenger tutte le volte che l'AI non riesce a leggere l'orario di
--    arrivo dal testo. Un vincolo che blocca un percorso legittimo per
--    proteggere un campo informativo è un vincolo che costa più di quel che
--    rende.
--
-- I confronti sugli enum passano da ::text di proposito (vedi CLAUDE.md):
-- confrontare una colonna enum con un letterale che l'enum non conosce
-- fallisce con 22P02 invece di dare falso.
--
-- ⚠️ PRIMA DI APPLICARE, eseguire questa query: elenca le righe che i vincoli
--    rifiuterebbero. ZERO RIGHE = si può procedere. Se ne esce qualcuna, va
--    sistemata prima (correggendo i campi, oppure mettendola in pausa):
--
--   select id, type::text, status::text,
--          route_from, route_to, depart_at, arrive_at, check_in, check_out
--     from public.listings
--    where (type::text = 'train' and (check_in is not null or check_out is not null))
--       or (type::text = 'hotel' and (depart_at is not null or arrive_at is not null
--                                     or route_from is not null or route_to is not null))
--       or (status::text in ('active','pending','reserved') and type::text = 'train'
--           and (depart_at is null
--                or btrim(coalesce(route_from, '')) = ''
--                or btrim(coalesce(route_to, '')) = ''))
--       or (status::text in ('active','pending','reserved') and type::text = 'hotel'
--           and (check_in is null or check_out is null));

ALTER TABLE public.listings
  ADD CONSTRAINT chk_listings_train_has_no_hotel_fields
  CHECK (
    type::text <> 'train'
    OR (check_in IS NULL AND check_out IS NULL)
  );

ALTER TABLE public.listings
  ADD CONSTRAINT chk_listings_hotel_has_no_train_fields
  CHECK (
    type::text <> 'hotel'
    OR (depart_at IS NULL AND arrive_at IS NULL
        AND route_from IS NULL AND route_to IS NULL)
  );

ALTER TABLE public.listings
  ADD CONSTRAINT chk_listings_live_train_complete
  CHECK (
    status::text NOT IN ('active', 'pending', 'reserved')
    OR type::text <> 'train'
    OR (depart_at IS NOT NULL
        AND btrim(coalesce(route_from, '')) <> ''
        AND btrim(coalesce(route_to, '')) <> '')
  );

ALTER TABLE public.listings
  ADD CONSTRAINT chk_listings_live_hotel_complete
  CHECK (
    status::text NOT IN ('active', 'pending', 'reserved')
    OR type::text <> 'hotel'
    OR (check_in IS NOT NULL AND check_out IS NOT NULL)
  );
