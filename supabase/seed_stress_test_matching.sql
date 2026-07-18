-- ============================================================
-- TravelSwapAI — Dataset di test per matching a 2 e a 3 (catena)
-- Da eseguire nel SQL Editor del progetto Supabase. NON è una migration
-- (nessuna modifica di schema): è dato di test, va nella cartella
-- supabase/ come reports_setup.sql/storage_setup.sql, non in migrations/.
--
-- COSA FA
-- Inserisce 12 annunci "active" per 4 utenti già esistenti, costruiti per
-- generare in modo deterministico:
--   • 1 catena a 3 (Roma→Milano→Napoli→Torino→Roma, tra U1/U2/U3): ognuno
--     ha ESATTAMENTE 1 VENDO attivo (requisito v1 del motore catene, vedi
--     server/src/models/chains.js groupListings) + un CERCO che vuole
--     esattamente ciò che il successivo nel ciclo vende.
--   • 3 match a 2 semplici (CERCO↔VENDO) tra U4 e ciascuno degli altri tre,
--     su tipi/tratte diverse dalla catena. U4 ha 3 VENDO attivi (non 1) e
--     0 CERCO: questo lo esclude DI PROPOSITO dal grafo delle catene
--     (serve avere esattamente 1 VENDO per parteciparvi), così i match a 2
--     con U4 non possono mai chiudersi in un ciclo a 3 accidentale.
-- Ogni riga usata dai due motori è stata scelta con città/tratte IDENTICHE
-- (non solo "vicine") in modo che il fallback deterministico (senza
-- OPENAI_API_KEY) basti da solo a superare le soglie — non serve un
-- consumo AI reale solo per popolare i dati.
--
-- PREREQUISITO — 4 utenti REALI (non creati da questo script)
-- Gli utenti vanno creati con la normale registrazione (app o Supabase
-- Admin API), MAI con un INSERT diretto in auth.users: quella tabella è
-- gestita da GoTrue (hash password, identities collegate, ecc.) e scriverci
-- a mano rischia account non funzionanti. Dopo la registrazione, recupera
-- i 4 UUID con:
--
--   select id, email from auth.users
--   where email in ('u1@test.travelswap','u2@test.travelswap','u3@test.travelswap','u4@test.travelswap')
--   order by email;
--
-- Poi incolla i 4 UUID trovati nelle variabili u1_id..u4_id qui sotto.
--
-- COME LEGGERE I RISULTATI DOPO L'INSERT
-- Questo script inserisce solo i dati: il calcolo vero e proprio (AI/
-- euristico) va poi lanciato via API (istruzioni fornite a parte, non qui:
-- servono chiamate HTTP autenticate, non SQL):
--   • match a 2: POST /api/matches/ai/recompute per OGNUNO dei 4 utenti
--     (autenticato come quell'utente).
--   • catena a 3: POST /api/chains/recompute (un'unica chiamata con il
--     secret di cron, scansiona tutti gli utenti).
--
-- CLEANUP
-- Tutti i titoli terminano con "[TEST-2-3]" per poterli riconoscere e
-- ripulire facilmente: query di cleanup in fondo al file (commentata).
-- ============================================================

DO $$
DECLARE
  -- <<< SOSTITUISCI questi 4 UUID con quelli reali recuperati sopra >>>
  u1_id uuid := '00000000-0000-0000-0000-000000000001';
  u2_id uuid := '00000000-0000-0000-0000-000000000002';
  u3_id uuid := '00000000-0000-0000-0000-000000000003';
  u4_id uuid := '00000000-0000-0000-0000-000000000004';
BEGIN

  -- Guardia di sicurezza: senza questo controllo, lasciare gli UUID
  -- placeholder farebbe fallire gli insert con una FK violation poco
  -- chiara (listings_user_id_fkey) invece di un messaggio comprensibile.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u1_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u2_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u3_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u4_id) THEN
    RAISE EXCEPTION 'Uno o più UUID placeholder non corrispondono a utenti reali in auth.users — crea prima i 4 account di test e sostituisci u1_id..u4_id in cima allo script.';
  END IF;

  -- ---------- Catena a 3: U1 -> U2 -> U3 -> U1 (treno) ----------
  -- U1 dà Roma->Milano, vuole Milano->Napoli (= ciò che dà U2)
  INSERT INTO public.listings
    (user_id, type, cerco_vendo, title, location, route_from, route_to, depart_at, arrive_at, price, currency, status, published_at)
  VALUES
    (u1_id, 'train', 'VENDO', 'Vendo treno Roma → Milano [TEST-2-3]', 'Roma-->Milano', 'Roma', 'Milano',
      now() + interval '10 days', now() + interval '10 days 3 hours', 39.90, 'EUR', 'active', now()),
    (u1_id, 'train', 'CERCO', 'Cerco treno Milano → Napoli [TEST-2-3]', 'Milano-->Napoli', 'Milano', 'Napoli',
      now() + interval '12 days', now() + interval '12 days 3 hours', 60.00, 'EUR', 'active', now());

  -- U2 dà Milano->Napoli, vuole Napoli->Torino (= ciò che dà U3)
  INSERT INTO public.listings
    (user_id, type, cerco_vendo, title, location, route_from, route_to, depart_at, arrive_at, price, currency, status, published_at)
  VALUES
    (u2_id, 'train', 'VENDO', 'Vendo treno Milano → Napoli [TEST-2-3]', 'Milano-->Napoli', 'Milano', 'Napoli',
      now() + interval '12 days', now() + interval '12 days 3 hours', 45.00, 'EUR', 'active', now()),
    (u2_id, 'train', 'CERCO', 'Cerco treno Napoli → Torino [TEST-2-3]', 'Napoli-->Torino', 'Napoli', 'Torino',
      now() + interval '14 days', now() + interval '14 days 3 hours', 65.00, 'EUR', 'active', now());

  -- U3 dà Napoli->Torino, vuole Roma->Milano (= ciò che dà U1, chiude il ciclo)
  INSERT INTO public.listings
    (user_id, type, cerco_vendo, title, location, route_from, route_to, depart_at, arrive_at, price, currency, status, published_at)
  VALUES
    (u3_id, 'train', 'VENDO', 'Vendo treno Napoli → Torino [TEST-2-3]', 'Napoli-->Torino', 'Napoli', 'Torino',
      now() + interval '14 days', now() + interval '14 days 3 hours', 52.00, 'EUR', 'active', now()),
    (u3_id, 'train', 'CERCO', 'Cerco treno Roma → Milano [TEST-2-3]', 'Roma-->Milano', 'Roma', 'Milano',
      now() + interval '10 days', now() + interval '10 days 3 hours', 55.00, 'EUR', 'active', now());

  -- ---------- Match a 2 semplici: U4 (solo VENDO) <-> U1/U2/U3 ----------
  -- U4 vende 3 cose diverse (hotel Firenze, treno Roma->Bologna, hotel
  -- Torino): avendo 3 VENDO attivi (non 1), U4 è escluso di proposito dal
  -- motore catene, quindi questi match restano a 2 puri, mai a 3.
  INSERT INTO public.listings
    (user_id, type, cerco_vendo, title, location, check_in, check_out, price, currency, status, published_at)
  VALUES
    (u4_id, 'hotel', 'VENDO', 'Vendo soggiorno hotel Firenze [TEST-2-3]', 'Firenze',
      (now() + interval '7 days')::date, (now() + interval '9 days')::date, 80.00, 'EUR', 'active', now()),
    (u4_id, 'hotel', 'VENDO', 'Vendo soggiorno hotel Torino [TEST-2-3]', 'Torino',
      (now() + interval '11 days')::date, (now() + interval '13 days')::date, 60.00, 'EUR', 'active', now());

  INSERT INTO public.listings
    (user_id, type, cerco_vendo, title, location, route_from, route_to, depart_at, arrive_at, price, currency, status, published_at)
  VALUES
    (u4_id, 'train', 'VENDO', 'Vendo treno Roma → Bologna [TEST-2-3]', 'Roma-->Bologna', 'Roma', 'Bologna',
      now() + interval '9 days', now() + interval '9 days 2 hours', 28.00, 'EUR', 'active', now());

  -- U1 vuole l'hotel di Firenze di U4
  INSERT INTO public.listings
    (user_id, type, cerco_vendo, title, location, check_in, check_out, price, currency, status, published_at)
  VALUES
    (u1_id, 'hotel', 'CERCO', 'Cerco hotel Firenze [TEST-2-3]', 'Firenze',
      (now() + interval '7 days')::date, (now() + interval '9 days')::date, 100.00, 'EUR', 'active', now());

  -- U2 vuole il treno Roma->Bologna di U4
  INSERT INTO public.listings
    (user_id, type, cerco_vendo, title, location, route_from, route_to, depart_at, arrive_at, price, currency, status, published_at)
  VALUES
    (u2_id, 'train', 'CERCO', 'Cerco treno Roma → Bologna [TEST-2-3]', 'Roma-->Bologna', 'Roma', 'Bologna',
      now() + interval '9 days', now() + interval '9 days 2 hours', 40.00, 'EUR', 'active', now());

  -- U3 vuole l'hotel di Torino di U4
  INSERT INTO public.listings
    (user_id, type, cerco_vendo, title, location, check_in, check_out, price, currency, status, published_at)
  VALUES
    (u3_id, 'hotel', 'CERCO', 'Cerco hotel Torino [TEST-2-3]', 'Torino',
      (now() + interval '11 days')::date, (now() + interval '13 days')::date, 75.00, 'EUR', 'active', now());

END $$;

-- ---------- Verifica rapida ----------
-- Atteso: 6 righe (U1,U2,U3 con esattamente 1 VENDO + 2 CERCO ciascuno),
-- 3 righe per U4 (3 VENDO, 0 CERCO).
SELECT user_id, cerco_vendo, count(*)
FROM public.listings
WHERE title LIKE '%[TEST-2-3]'
GROUP BY user_id, cerco_vendo
ORDER BY user_id, cerco_vendo;

-- ============================================================
-- CLEANUP (da eseguire a parte quando vuoi rimuovere il dataset di test)
-- ============================================================
-- delete from public.listings where title like '%[TEST-2-3]';
