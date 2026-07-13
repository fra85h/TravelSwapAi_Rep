# TravelSwapAI — Roadmap migliorie proposte

Documento di lavoro con le migliorie individuate analizzando il codice.
Ordinato per rapporto **valore / sforzo**. Le voci ✅ sono già state applicate.

---

## A. Pulizie già applicate (rischio zero)

- ✅ Rimosso `lib/googleAuthNative.js`: codice morto con import rotto (`./supabaseClient` inesistente), non importato da nessun file.
- ✅ Rimosso dal dettaglio annuncio il chip che mostrava il **PNR**: è un dato riservato e non deve mai apparire nella scheda pubblica.
- ✅ (in sessione) Rimosso il pulsante "Test bridge" di debug dalla schermata di login.

---

## B. Bug / gap funzionali da chiudere (priorità alta)

### B1. Il PNR non viene salvato — ✅ FATTO
Il form raccoglieva il PNR ma non lo passava mai al salvataggio, e la colonna era stata rimossa da `listings`.
Implementato: `insertListing`/`updateListing` salvano ora il PNR in `listing_secrets` (helper `savePnrSecret`, policy RLS "own secrets" già presente); in modifica il PNR viene riletto con `getListingSecret`. Corretto anche un potenziale crash: `updateListing` estrae `pnr` dal patch, evitando di scriverlo sulla colonna inesistente.

### B2. Login Google via proxy deprecato
Il redirect usa `auth.expo.io` (proxy Expo dismesso) → il login non si completa. **Fix definitivo:** redirect basato sullo scheme dell'app (`travelswap://auth/callback`) tramite una **development build**, dove diventa stabile. (già in agenda con te)

---

## C. Funzionalità già predisposte nel DB ma non sfruttate (alto valore)

Queste tabelle esistono nello schema ma l'app non le usa affatto — sono "vinte a metà": manca solo il lato app.

### C1. Preferiti / Wishlist — `saved_listings` — ✅ FATTO
Implementato: `lib/savedListings.js` (CRUD sui preferiti), componente `SaveButton` (stella ⭐), schermata `SavedScreen`, stella nel dettaglio annuncio e sulle card della Home, accesso "I miei preferiti" dal Profilo (it/en/es).

### C2. Galleria immagini — `listing_images` — ✅ FATTO (richiede setup Storage)
Implementato: `lib/listingImages.js` (upload su Supabase Storage + CRUD `listing_images`), `components/ImageCarousel.js` (carosello nel dettaglio), `screens/ManageImagesScreen.js` (aggiungi/rimuovi foto dal proprio annuncio già pubblicato).
Aggiunto anche il selettore foto **direttamente nel form di creazione/modifica annuncio** (`CreateListingScreen`, sezione "Foto" sotto il titolo): in creazione le foto restano in sospeso e vengono caricate dopo la pubblicazione (appena esiste l'id dell'annuncio); in modifica si caricano/eliminano subito.
Prerequisiti d'attivazione: eseguire `supabase/storage_setup.sql` (bucket `listing-images` + policy) e installare `expo-image-picker` + `base64-arraybuffer`.

### C3. Storico transazioni — `transactions` — ✅ FATTO
Implementato: `lib/transactions.js` (lettura con join sull'annuncio), `screens/TransactionsScreen.js` (lista con badge Venduto/Ricevuto), accesso "🧾 I miei scambi" dal Profilo, tradotto it/en/es.

**Scoperta importante**: nessuna funzione scriveva mai in `transactions` — modificata `accept_offer_any()` (unica funzione di accettazione usata dall'app) per registrare 1 riga per un buy, 2 righe per uno swap (una per ciascun annuncio che cambia proprietario), in modo atomico con l'accettazione stessa.

**⚠️ Bug critici preesistenti trovati testando in locale, indipendenti dalla feature**: accettare/rifiutare/cancellare **qualsiasi** offerta falliva sempre in produzione, per due cause distinte:
1. `_norm()` veniva chiamata su `offers.status` (un ENUM) come se fosse testo — Postgres non fa il cast implicito. Rotto in 4 funzioni/trigger.
2. L'enum `listing_status` non conteneva `pending`/`reserved`/`swapped`, valori impostati attivamente da `accept_offer_any()`.

Entrambi corretti con migrazioni dedicate, validate con un test end-to-end reale (due utenti simulati, scenario buy e swap) applicato **nell'ordine esatto dei nomi file** di produzione. Vedi `supabase/README.md` — vanno applicate sul progetto Supabase reale.

---

## D. Innovazione (funzionalità nuove)

### D1. Notifiche push su match e offerte
Con `expo-notifications`: avvisa l'utente quando arriva una nuova offerta o un nuovo match forte. È la leva n.1 per far tornare gli utenti nell'app. (richiede development build)

### D2. Chat in-app per le offerte
Oggi si può fare un'offerta ma non trattare. Una chat leggera per ogni offerta (tabella `messages` da aggiungere) sbloccherebbe la negoziazione e ridurrebbe gli scambi "fuori piattaforma" (che le euristiche antifrode già segnalano come rischio).

### D0. Swap a catena + normalizzazione AI — ✅ TUTTE E 4 LE FASI FATTE (schema, motore, spiegazione, UI)
Analisi di mercato con simulazione sintetica (300 utenti, 10 run): il matching reciproco diretto di oggi intercetta solo ~0,3% degli utenti; catene multi-parte da sole non cambiano nulla (~0,3% anche loro); **solo la combinazione catena + normalizzazione AI (tolleranza data/area) sblocca ~92%**. Deciso con te: catene di **esattamente 3** utenti, chiusura solo quando **tutti e 3 confermano esplicitamente** (nessuna esecuzione automatica).

**Fase 1** (schema + funzioni, validata su Postgres locale con scenario felice/rifiuto/race-condition/permessi):
- `chain_proposals`/`chain_participants` (RLS: solo i partecipanti vedono la propria catena).
- `create_chain_proposal()` — solo `service_role`, valida ciclo chiuso + proprietà + stato `active` di ogni annuncio.
- `confirm_chain_participant()` — chiude atomicamente solo a 3/3 conferme: annunci → `reserved`, offerte 1:1 pendenti su quegli annunci rifiutate, 3 righe in `transactions` (stesso trattamento di `accept_offer_any()` generalizzato a 3 lati). Se un annuncio non è più `active` al momento della chiusura (venduto altrove nel frattempo), la catena decade senza toccare nulla.
- `decline_chain_participant()` — un rifiuto fa decadere subito la catena, nessun effetto collaterale.
- Bug trovati e corretti durante il test locale: ricorsione infinita nella policy RLS di `chain_participants` (self-query) e un `REVOKE ALL ... FROM PUBLIC` che non bastava a bloccare `authenticated` su Supabase (i permessi di default vanno direttamente ai ruoli, non solo a `PUBLIC`).

**Fase 2** (motore lato server che *trova* i cicli, `server/src/models/chains.js` + `server/src/ai/chainMatch.js`):
- Grafo dei desideri: per ogni annuncio CERCO di un utente, cerca tra gli annunci VENDO di altri utenti (stesso tipo) quelli che lo soddisferebbero, poi cerca cicli chiusi di 3 proprietari nel grafo risultante (`findThreeCycles`, funzione pura, **9 + 6 test unitari**, `node --test`).
- Normalizzazione fuzzy con lo stesso pattern già usato dal matcher 1:1 esistente (`ai/score.js`): **AI primaria** (prompt dedicato, tollera città vicine/varianti testuali e ±3 giorni) **con fallback euristico deterministico** (cluster geografico statico + tolleranza data) se la chiave OpenAI manca o la chiamata fallisce — la ricerca cicli non si blocca mai. La soglia di punteggio (65/100) passa solo quando l'area è compatibile, la sola vicinanza di data non basta.
- Nuovo endpoint `POST /api/chains/recompute`, protetto da un secret condiviso (`CHAIN_CRON_SECRET`, header `X-Cron-Secret`) e non dal login utente — scansiona gli annunci di *tutti* gli utenti, quindi non va esposto al client. **Fail-closed**: se il secret non è configurato, l'endpoint rifiuta sempre (503) invece di restare aperto per errore.
- v1: considera solo i proprietari con **esattamente un** annuncio VENDO attivo (evita l'ambiguità di "quale dei suoi annunci starebbe dando" se ne ha più di uno) — limite noto, da rilassare in un secondo momento.
- ⚠️ Non testato end-to-end contro un vero progetto Supabase/OpenAI in questa sessione (nessuno dei due disponibile nell'ambiente): la logica pura (ricerca cicli, punteggio euristico) è coperta da test automatici in CI; le query Supabase sono scritte solo con pattern già usati altrove nel codebase (niente sintassi nuova non verificabile) proprio per questo motivo.
- Bug preesistente scoperto per caso durante lo smoke test (non introdotto da questa modifica): `server/src/services/trust/aiTrust.js` fa crashare **l'intero server** all'avvio se manca `OPENAI_API_KEY` (chiama `new OpenAI(...)` senza controllare la chiave, a differenza di `ai/score.js` che lo fa correttamente). Segnalato, non ancora corretto.

**Fase 3** (spiegazione in linguaggio naturale, `server/src/ai/chainExplain.js`):
- Colonna `chain_proposals.explanation` (nuova migrazione), riempita subito dopo la creazione della proposta — non a ogni visualizzazione.
- Stesso pattern di resilienza delle altre due fasi AI: **AI primaria** (prompt dedicato, max 3 frasi, non nomina mai persone reali) **con fallback a un template deterministico sempre disponibile** se la chiave manca o la chiamata fallisce — una spiegazione mancante non è mai motivo per bloccare la creazione della catena (se il salvataggio della spiegazione fallisce, la catena resta comunque valida, solo senza testo).
- Il template deterministico descrive meccanicamente i 3 passaggi ("chi dà X riceve Y, chi dà Y riceve Z, chi dà Z riceve X") usando le tratte/città e le date, senza mai esporre nomi utente prima che la catena sia confermata.
- 5 test unitari nuovi sul template (route treno, città hotel, nessun nome esposto, input malformato, data mancante).

**Fase 4** (UI, `screens/ChainProposalsScreen.js` + `lib/chains.js`):
- Nuova schermata, raggiungibile dal Profilo ("🔗 Proposte di scambio a 3"), che mostra le catene attive di cui l'utente fa parte: spiegazione in linguaggio naturale, i 3 passaggi con stato di conferma di ciascuno (✓/⏳), e "N di 3 hanno confermato".
- Se l'utente non ha ancora confermato: pulsanti Conferma/Rifiuta. Se ha già confermato: stato "in attesa degli altri" con possibilità di ritirare la conferma (rifiuta comunque, prima che si chiuda per tutti).
- `lib/chains.js` legge in 4 passaggi separati (`.eq()`/`.in()`, nessun join annidato PostgREST) per lo stesso motivo di cautela della fase 2: nessuna sintassi non verificabile in questo ambiente.
- Tradotta interamente in it/en/es dall'inizio (16 chiavi nuove in `chains.*` + 1 in `profile.chainProposals`, parità verificata).
- ⚠️ Come le fasi precedenti, non testata su dispositivo reale (nessun modo di eseguire l'app in questo ambiente) — solo controllo sintattico e verifica di parità i18n.

✅ **Testata end-to-end con dati reali dall'utente** (3 account di test, un ciclo Roma→Milano / Torino→Roma / Napoli→Bari creato via SQL Editor): il trigger periodico ha trovato il ciclo, creato la proposta, e la schermata l'ha mostrata correttamente nel Profilo. Prima vera conferma su un progetto Supabase reale, non solo in locale.

**Migliorie fatte dopo il primo test utente** (la spiegazione era poco chiara, e a scambio completato la card spariva senza nessun feedback):
- Aggiunta una versione visiva del giro nella card: frecce tra i 3 passaggi + un'icona "torna al primo" per chiudere visivamente il cerchio, e il verbo esplicito "dà" invece del solo trattino.
- Aggiunto un popup di conferma quando lo scambio si chiude con successo (🎉), e uno separato se decade per un annuncio non più disponibile nel frattempo — prima in entrambi i casi la card spariva silenziosamente, senza che l'utente sapesse cosa fosse successo.
- 7 chiavi i18n nuove, parità verificata.

**Non ancora fatto / prossimi passi**:
- La spiegazione è generata solo in italiano per ora (come le altre feature AI esistenti, non localizzate) — da rivedere se serve multilingua.
- Nessun badge/notifica quando arriva una nuova proposta — l'utente deve aprire la schermata per scoprirla (va bene per un primo test, da migliorare se il volume cresce).
- **Fatto sul progetto Supabase reale**: migrazioni applicate, `CHAIN_CRON_SECRET`/`OPENAI_API_KEY` configurati su Render, trigger periodico attivo su cron-job.org.

### D3. Avvisi di ricerca ("price/route alert") — ✅ FATTO
"Avvisami quando compare un treno Roma→Milano sotto 40€". Implementato: tabelle `saved_searches`/`saved_search_matches`, matching deterministico e letterale (`server/src/models/savedSearches.js`, nessun fallback AI necessario), job periodico `/api/saved-searches/recompute` protetto da `X-Cron-Secret` condiviso con le catene, schermata `SavedSearchesScreen.js` (crea/pausa/elimina, vede i trovati). Testato con un test di integrazione ad-hoc su Postgres locale.

### D4. Onboarding con preferenze — ✅ FATTO
Implementato: `screens/PreferencesOnboardingScreen.js` + `lib/preferences.js`. Mostrata **una sola volta per account**, subito dopo la registrazione (o al primo login se non era mai stata vista) — non ad ogni avvio: il segnale è `profiles.prefs.onboarded`, assente finché l'utente non salva o salta. Renderizzata fuori dallo Stack Navigator (nessuna nuova route da gestire), come passaggio intermedio tra login e `MainTabs`.

Raccoglie esattamente i 3 campi già letti dal matcher euristico esistente (`server/src/ai/score.js`: `prefs.types`/`prefs.maxPrice`/`prefs.location`) — **zero modifiche al backend/DB**, la colonna `profiles.prefs` (jsonb) esisteva già mai popolata in modo guidato. "Salta per ora" scrive comunque `{onboarded:true}` per non ripresentare il prompt ad ogni avvio, senza impostare preferenze funzionali (comportamento del matching invariato per chi salta).

Tradotto interamente in it/en/es dall'inizio (12 chiavi nuove in `prefsOnboarding.*`, parità verificata).

⚠️ Non testato su dispositivo reale in questa sessione (nessun modo di eseguire l'app qui) — solo controllo sintattico e verifica i18n.

### D5. Import annunci via bot Messenger + collegamento account — ✅ FATTO (attivazione manuale da fare)
Idea nata da una valutazione richiesta esplicitamente: importare gli annunci di un utente dai gruppi Facebook via login Facebook **non è realizzabile** — l'API Graph non espone (e non ha mai esposto, dopo il 2018) un modo per un'app terza di leggere i post di un utente, propri o altrui, dentro gruppi che non amministra. Il vincolo è strutturale (lato piattaforma), non aggirabile con permessi più ampi.

L'alternativa scoperta analizzando il codice: esisteva già, dormiente, un **bot Messenger** completo (`server/src/index.js`, webhook `/webhooks/facebook`) che usa il vero parser AI (`fbParser.js`, OpenAI) per trasformare un testo incollato in un annuncio strutturato, con conversazione a stati (chiede i campi mancanti, riepiloga, chiede conferma). Non richiede nessun permesso Facebook speciale: rispondere a chi scrive alla propria Pagina è funzionalità base della Messenger Platform.

Gap trovato e chiuso in questa sessione: **ogni annuncio importato finiva sotto un unico account fisso** (`DEFAULT_LISTING_OWNER_ID`), non nel profilo di chi scriveva. Aggiunto un collegamento identità:
- Tabelle `fb_link_codes` (codice monouso, 15 minuti) e `fb_account_links` (mappatura permanente sender Messenger → utente), entrambe service-role only (stesso pattern di `fb_sessions`: RLS abilitata, nessuna policy, revocato accesso ad `anon`/`authenticated`)
- Endpoint autenticato `POST /api/fb-link/code` (`requireAuth` + rate limit 5/10min) che genera il codice per l'utente loggato
- Il bot riconosce un messaggio-codice PRIMA di trattarlo come testo di un annuncio (`looksLikeLinkCode`), e se valido crea il collegamento e conferma
- I due punti che pubblicano da Messenger (`PUB_CONFERMA`, sia da postback che da quick reply) risolvono l'`ownerId` dal collegamento prima di scrivere l'annuncio, con fallback automatico all'account condiviso per chi non si è ancora collegato (nessuna rottura per il flusso esistente)
- App: `screens/LinkMessengerScreen.js` (genera codice, mostra scadenza e istruzioni), voce "💬 Collega Messenger" nel Profilo

Testato: 8 nuovi unit test (formato codice), integrazione contro Postgres locale (RLS, upsert-overwrite su ri-collegamento, marcatura "usato"), smoke test del server con le nuove route, esbuild + bundle Metro completo, parità i18n 533/533/533.

⚠️ **Resta da fare, fuori dal codice**: attivare davvero il bot serve una Pagina Facebook reale collegata a un'app su Meta for Developers, con token e webhook registrati — passaggi di configurazione, non di programmazione, simili a cron-job.org. Il codice è pronto e testato, ma il bot non risponderà finché quella parte non viene fatta.

### D6. Stessa cosa per Instagram (DM del profilo business)
Richiesta esplicitamente come estensione di D5. Fattibile con sforzo di programmazione simile: si riusano il parser AI (`parseFacebookText`) e il sistema di collegamento account (`fb_link_codes`/`fb_account_links`, gli ID mittente Instagram non collidono con quelli Messenger) — va solo esteso il webhook per accettare anche eventi `object: 'instagram'` oltre a `'page'`.

Prerequisiti in più rispetto a Messenger (verificati a luglio 2026, le regole Meta cambiano spesso):
- L'account Instagram deve essere **Business o Creator** (conversione gratuita se non lo è già)
- Va collegato alla stessa Pagina Facebook già usata per Messenger (strada "Facebook Login for Business" — riusa il setup esistente, a differenza della strada alternativa "Instagram Login" che userebbe una configurazione Meta separata)
- Serve il permesso `instagram_manage_messages` in **Advanced Access**, che richiede una revisione da parte di Meta — stesso tipo di ostacolo già previsto per portare Messenger in produzione vera, non uno nuovo

Non risolve (né potrebbe): leggere automaticamente i post/Reels già pubblicati da un utente — stesso vincolo strutturale di piattaforma di D5, vale anche per Instagram.

Messo in coda dopo D5: ha senso partire solo dopo aver verificato che il bot Messenger funzioni bene nella pratica.

---

## F. Restyling "Swap Gold" — ✅ prima tranche applicata

Direzione scelta dopo confronto visivo di 3 varianti (indigo raffinato / indigo saturo / **indigo + oro**): oro come accento dei CTA principali — richiama la moneta 3D dell'onboarding e il concetto di scambio di valore del nome "Swap".

- `lib/theme.js`: nuovi token `accent`/`accentSoft`/`accentOn` (oro + inchiostro indigo abbinato); `primary` raffinato ma **ruolo invariato** (resta lo sfondo chiaro di badge/pill, per non rompere i ~25 punti che lo usano già); aggiunta `shadow.lg` e tipografia con letter-spacing.
- `components/ui/Button.js`: CTA primario ora oro con testo indigo e ombra dorata; variante `outline` corretta (prima aveva un bug di contrasto: testo/bordo quasi invisibili).
- `components/ui/Input.js`: bordo dorato al focus.
- `components/SaveButton.js`, `components/ImageCarousel.js`, `screens/ManageImagesScreen.js`: allineati allo stesso oro (prima usavano tonalità scollegate o poco leggibili).
- Pulsante "Pubblica/Modifica annuncio" (`CreateListingScreen`): oro con ombra dedicata — è il CTA più importante dell'app.
- `MatchCard`: badge "💫 reciproco" passato da un blu generico all'oro (è un momento "premium" della UI, i match forti).
- Card di Home/Offerte/Profilo: da bordo piatto grigio a ombra morbida coerente col tema (stesso ~1 riga di stile per file).

- ✅ **Font custom**: caricato **Plus Jakarta Sans** (pesi 600/700/800) via `expo-font` + `@expo-google-fonts/plus-jakarta-sans`, con gate di caricamento in `App.js`. Applicato ai 4 "hero moment" più visibili: wordmark `HeaderLogo`, titoli onboarding, headline "Benvenuto" del login, titolo annuncio nel dettaglio. Il resto del testo (corpo, label, bottoni) resta sul font di sistema — coppia display+body deliberata, non un rifacimento totale.

- ✅ **Terza tranche**: estesa l'ombra morbida ai contenitori-card rimanenti (`OfferFlow`, `OfferDetailScreen`, `MatchingScreen` — lasciati intenzionalmente piatti input/chip/skeleton loader, che non sono card). Trovato e sistemato un altro CTA ad alto impatto: il **FAB "Ricalcola AI"** in Matching passa da lavanda chiaro a oro con ombra dorata, stesso trattamento del pulsante "Pubblica". Aggiunto anche il badge "selezionato" (`cardSelected` in OfferFlow) in oro. Font esteso ai titoli di `OfferFlow`, `OfferDetailScreen`, `MatchingScreen`.

- ✅ **Unificazione icone**: verificato scaricando il pacchetto reale da npm (non più "non verificabile offline") che Ionicons ha `train-outline`/`bed-outline` — sostituiti i 2 usi di `lucide-react-native` (Home, Profilo) e rimossa la dipendenza dal `package.json`. Icone ora tutte su `@expo/vector-icons` (Ionicons + AntDesign).

Non ancora fatto (prossimo passo naturale): estensione font ai titoli rimanenti (Profilo, form creazione annuncio).

---

## E. Qualità del codice / infrastruttura

- ✅ **i18n Login/Password dimenticata/Preferiti/Gestione foto** — collegate al dizionario. Il `LoginScreen` era **completamente** hardcoded in italiano (zero chiamate a `t()`): scoperto che esisteva già una sezione `auth.*` con 20 chiavi pronte proprio per questo schermo, mai collegata. Aggiunte solo le 9 chiavi mancanti (in it/en/es, parità verificata) invece di ricostruire da zero. Corretto anche un bug collaterale: `theme.colors.muted`/`theme.colors.link` non esistono nel tema (rientravano al colore di default invece di quello voluto).
- ✅ **Riduzione `console.log`**: rimossi/protetti dietro `__DEV__` i log che stampavano URL OAuth completi (incluso il `code` PKCE) in `LoginScreen`, `OAuthCallbackScreen` — prima venivano loggati anche in produzione. Gate aggiunto anche a `lib/auth.js` (id utente ad ogni cambio sessione), `App.js` (log `[WHOAMI]` ad ogni avvio), `components/OfferCTA.js`.
- ✅ **i18n completato**: `EditProfileScreen` (era 100% hardcoded, ora su dizionario `editProfileScreen.*`), tutti i 30 `Alert.alert` di `CreateListingScreen` (foto, Check AI/TrustScore, fix suggeriti, stima prezzo, pubblicazione, bozza, import PNR/QR — nuova sezione `createListing.*` con ~28 chiavi nuove), l'ultimo alert rimasto in `MatchingScreen` (errore backend). `OffersScreen` era già completo. Parità it/en/es verificata per ogni chiave nuova.
- ✅ **Audit i18n sistematico (tutto l'app)**: estratte tutte le 344 chiavi `t("...")` usate nel codice e verificata la risoluzione in it/en/es (script Node riusabile). Trovati e corretti bug reali con lo stesso pattern "chiave rotta → fallback italiano silenzioso, in qualsiasi lingua": il tab bar "Home" (chiave `home.title` inesistente), gran parte della legenda Matching (`verygood`/`rule` mancanti, `it` senza l'oggetto `legend` strutturato), **l'intera schermata `OfferFlow`** (~25 chiavi mai collegate al dizionario — il flusso di acquisto/scambio, cioè il cuore economico dell'app, mostrava sempre testo italiano indipendentemente dalla lingua), i pulsanti "Vedi solo perfetti/Ordina per novità" e altri controlli di Matching (`cta.*`, `hide`, `info`, `status.error/tip`), i messaggi di salvataggio modifiche in `CreateListingScreen` (`editListing.*`, mai esistiti), le etichette filtro in `OffersScreen`/`OfferCard` (treni/hotel/voli), le azioni "Proponi acquisto/scambio" nel dettaglio offerta, l'intestazione foto nel form annuncio, e il gap storico `createListing.cercoVendoLabel/cerco/vendo` in inglese. **Zero chiavi mancanti residue** su tutto l'app dopo questo giro.
- ✅ **Bug funzionale scoperto e corretto**: in `components/OfferCTA.js` i pulsanti "Proponi acquisto"/"Proponi scambio" (usati sia in Home che nel dettaglio annuncio, stesso componente) avevano `onPress` che non facevano nulla oltre a un `console.log` — TODO mai completati. Ora navigano a `OfferFlow` con `{ mode: "buy"|"swap", listingId }`.
  Trovato un secondo bug collegato: `OfferFlow` confrontava `mode === "BUY"` (maiuscolo stretto), ma l'unico chiamante preesistente (`OfferDetailScreen`) passava `"buy"`/`"swap"` minuscolo — quindi il flusso mostrava **sempre** la UI di scambio, mai quella di acquisto, indipendentemente dal pulsante premuto. Reso il confronto case-insensitive, cosa che ripara anche `OfferDetailScreen` senza toccarlo.
- **Development build (EAS)**: necessaria per push, OAuth stabile e pubblicazione sugli store. È lo sblocco per D1/D2 e B2.
- **Migrazione graduale a TypeScript**: ridurrebbe i bug di forma dei dati (già oggi ci sono alias `asset_type`/`type`, `depart_at`/`start_date` gestiti a mano).
- **Rate limiter server su store condiviso** (Redis/Postgres) se si scala su più istanze.

---

## Ordine consigliato — aggiornato 13 luglio 2026

Tutto A/B/C/D0/D3/D4/D5 e la valutazione UX completa (nuova architettura a 4 tab, restyle oro, quality check) sono ✅ fatti. Quello che resta:

1. **Provare su un dispositivo reale** ciò che è stato costruito senza mai poterlo eseguire in questo ambiente — priorità sopra qualunque nuova feature, prima di continuare a costruire su basi non ancora viste dal vivo
2. **Attivare per davvero D5** (Pagina Facebook + Meta for Developers) — codice pronto, manca solo la configurazione
3. **Development build (EAS)** → sblocca **B2 Google**, **D1 notifiche push**, e rende D6/il "Condividi" nativo più facili
4. **D6 Instagram** (dopo aver verificato D5 nella pratica)
5. **D1 Notifiche push** → poi **D2 Chat**
6. Sul lungo periodo: migrazione TypeScript, rate limiter su store condiviso
