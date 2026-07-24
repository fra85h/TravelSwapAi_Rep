# TravelSwapAI — Analisi funzionale (reverse engineering)

> Documento ricavato dall'analisi del codice sorgente (app mobile + server).
> Data analisi: luglio 2026.

---

## 1. Scope e visione del prodotto

**TravelSwapAI è un marketplace peer-to-peer per rivendere o scambiare prenotazioni di viaggio non utilizzate.** Gli asset attualmente supportati sono due:

- **Biglietti del treno** (tratta, data/ora partenza e arrivo, biglietto nominativo, PNR)
- **Prenotazioni hotel** (località, check-in, check-out)

Gli utenti pubblicano annunci in modalità **CERCO** o **VENDO**; la piattaforma consente di:

- fare **offerte di acquisto (BUY)** con importo, oppure **proposte di scambio (SWAP)** tra due annunci;
- trovare automaticamente le corrispondenze tra domanda e offerta tramite **matching AI**;
- valutare l'affidabilità di ogni annuncio con un **TrustScore antifrode**;
- **importare annunci da Facebook** (post nei gruppi e conversazioni Messenger) trasformandoli in annunci strutturati.

Il mercato di riferimento è quello italiano: lingua di default `it`, riferimenti a Italo/Frecciarossa nel parser, testi del bot in italiano. L'app è comunque predisposta per **italiano, inglese e spagnolo**.

Nel codice compare occasionalmente il tipo `flight` (voli), ma non è supportato end-to-end: è uno scope futuro accennato, non una funzionalità attiva.

---

## 2. Architettura

Il repository contiene due progetti:

```
TravelSwapAi_Rep/
├── server/                      # Backend Node.js/Express (layer AI + webhook Facebook)
│   └── src/
│       ├── index.js             # Bootstrap, webhook FB, bot Messenger
│       ├── routes/              # listing, match, trustscore, translateListings, offers, chains, savedSearches, pings, fbLink, notify, reportsNotify, priceCheck
│       ├── ai/                  # score.js (matching AI), descriptionParse.js, chainMatch.js, chainExplain.js, priceCheck.js
│       ├── services/trust/      # heuristics, aiTrust, store, translate
│       ├── parsers/fbParser.js  # Estrazione campi da testi Facebook
│       ├── models/              # listings, matches, fbIngest, fbSessionStore, chains, fbLink, pings, savedSearches
│       ├── middleware/          # requireAuth (JWT Supabase), rateLimit, requireCronSecret
│       └── lib/                 # announceRules, fbSend, mailer, push
└── travelswap_ai/travelswapai/  # App mobile React Native + Expo SDK 54
    ├── App.js                   # Root navigator, deep linking, provider
    ├── screens/                 # Home, Offers, Matching, Profile, CreateListing, …
    ├── lib/                     # supabase, db, offers, api, i18n, useTrustScore, …
    └── components/              # UI kit, TrustScoreBadge, MatchCard, OfferCTA, …
```

### Stack tecnologico

| Livello | Tecnologia |
|---|---|
| App mobile | React Native 0.81 + Expo SDK 54, React Navigation (stack + bottom tabs), react-native-paper, EAS build |
| Backend | Node.js + Express 4 (ESM), deploy su Render (dedotto dai commenti) |
| Database & Auth | Supabase (Postgres + RLS + RPC + Auth). L'app usa la **anon key**, il server la **service role key** |
| AI | OpenAI `gpt-4o-mini` (matching, trust, parsing, traduzione) — Responses API e Chat Completions |
| Canali esterni | Facebook Graph API (webhook feed + Messenger Send API) |

### Flussi di comunicazione

- **App → Supabase (diretto)**: auth, CRUD annunci, offerte, profili, RPC. La sicurezza dei dati è delegata alle policy RLS e alle funzioni RPC lato Postgres.
- **App → Server Express**: funzioni AI (trustscore, parsing descrizione, matching, traduzione) via `EXPO_PUBLIC_API_BASE`, con bearer token Supabase.
- **Facebook → Server Express**: webhook `GET/POST /webhooks/facebook` con verifica firma HMAC-SHA256.
- **Server → Supabase**: accesso completo con service role key (bypassa RLS).

---

## 3. Funzionalità — App mobile

### 3.1 Autenticazione e onboarding
- Onboarding iniziale (slide di presentazione).
- Login email/password via Supabase Auth.
- **Google Sign-In** nativo (`@react-native-google-signin`) + OAuth con deep link (`travelswap://auth/callback`, schermata `OAuthCallbackScreen`).
- Recupero password (`ForgotPasswordScreen`).
- Profilo utente (`ProfileScreen`, ~550 righe) con modifica dati (`EditProfileScreen`) su tabella `profiles`.

### 3.2 Navigazione principale (bottom tabs)
1. **Home / Annunci** — lista annunci pubblici attivi (esclusi i propri), filtro per tipo (tutti / hotel / treno), badge TrustScore, icone per tipologia, CTA per fare offerte, pulizia automatica del prezzo dal titolo.
2. **Offerte** — offerte in entrata e in uscita, con accettazione/rifiuto/cancellazione.
3. **Matching** — schermata più complessa (~880 righe): ricalcolo on-demand dei match AI via backend, visualizzazione con score, spiegazione e flag di reciprocità (match bidirezionale).
4. **Profilo** — dati utente, i propri annunci, impostazioni lingua (`LanguageSwitcher`).

### 3.3 Creazione annuncio (`CreateListingScreen`, ~1.600 righe)
- Form guidato differenziato treno/hotel (tratta+date/orari vs località+check-in/out).
- **Titolo auto-generato** dai campi compilati.
- **Bozza persistente** in AsyncStorage (`@tsai:create_listing_draft`).
- **Compilazione automatica via AI**: l'utente incolla un testo libero e il parser server-side estrae tipo, CERCO/VENDO, tratta, date, prezzo, PNR ecc.
- **Scanner QR/barcode** con fotocamera (QR, EAN-13/8, Code128, Code39, PDF417, UPC) per importare i dati del biglietto, con simulatore di scansione in dev.
- Calcolo e visualizzazione del **TrustScore** in fase di creazione (`useTrustScore`, `TrustScoreBadge`, `TrustInfo`).

### 3.4 Offerte e scambi
- **BUY**: proposta di acquisto verso un annuncio, con importo e messaggio (`createOfferBuy`).
- **SWAP**: scambio "offro il mio annuncio X per il tuo Y" (`createOfferSwap`), con flusso dedicato di selezione (`OfferFlow`).
- Accettazione/rifiuto tramite RPC Postgres (`accept_offer_any` / `decline_offer_any`, tolleranti su tipo id uuid/int).
- Cancellazione della propria offerta pending; dettaglio offerta (`OfferDetailScreen`).
- Liste incoming/outgoing sia con query dirette sia con RPC dedicate (`list_incoming_offers_any`, `list_outgoing_offers_any`) — doppia implementazione, cfr. §7.

### 3.5 Internazionalizzazione e traduzione
- i18n con dizionari **it / en / es** (`lib/i18n`), default italiano, fallback e interpolazione variabili.
- **Traduzione on-demand degli annunci** nella lingua dell'utente via backend (`useListingTranslation` → `GET /api/listings/:id/translate?lang=xx`), con cache su DB.

---

## 4. Funzionalità — Backend

### 4.1 Matching AI (`/api/matches/*`)
- `GET /api/matches/snapshot?userId=` — legge l'ultimo snapshot dei match dell'utente.
- `POST /api/matches/snapshot/recompute` — ricalcola lo snapshot aggregato (top N per annuncio, max totale).
- `POST /api/matches/ai/recompute` — pipeline completa: scoring AI → snapshot → risposta.

Meccanica (`ai/score.js`, `models/matches.js`):
- Per ogni annuncio dell'utente, i candidati (annunci attivi di altri utenti, fino a 500) vengono inviati a GPT-4o-mini **in batch da 40** con **output JSON strutturato** (json_schema strict): `{ id, score 0-100, bidirectional, explanation }`.
- Prompt con regole vincolanti: reciprocità CERCO/VENDO + stessa tratta/giorno ⇒ `bidirectional: true`.
- Determinismo: temperature 0, ordinamento stabile, seed derivato dall'userId, normalizzazione/dedup/clamping dell'output.
- Esecuzione parallela con **pool di concorrenza configurabile** (default 4) e retry con backoff su timeout/5xx.
- **Fallback euristico deterministico** (`heuristicScore`: base 60, +15 tipo preferito, +10 prezzo entro budget, +10 località) — collegato in `recomputeMatches`: se l'AI non risponde (timeout/chiave mancante/schema invalido) lo sostituisce, invece di lasciare l'utente senza match.
- Persistenza su tabella `matches` (upsert su `from_listing_id,to_listing_id`) e snapshot JSON su `match_snapshots`, con **skip dello snapshot se identico al precedente**.
- Esiste anche una variante SQL-first (`fn_user_top_matches` RPC) alternativa al calcolo JS.

### 4.2 TrustScore antifrode (`POST /ai/trustscore`)
Pipeline a due stadi con fusione pesata:

1. **Euristiche** (`computeHeuristicChecks`): consistenza, plausibilità, completezza dell'annuncio.
2. **Review AI multimodale** (`aiTrustReview`): GPT-4o-mini in modalità JSON analizza testo **e fino a 4 immagini** dell'annuncio, restituendo `textScore`, `imageScore`, flag di rischio e correzioni suggerite. Fallback automatico se manca la chiave OpenAI.
3. **Fusione**: `trustScore = 45% euristiche + 45% AI testo + 10% AI immagini`.

Corredato da: autenticazione bearer (JWT Supabase), **rate limiting** (10 chiamate / 10 minuti per utente), validazione input (express-validator), **audit log** su tabella `trust_audit` (best-effort, non blocca la risposta). Il punteggio più recente per annuncio è esposto dalla vista `v_latest_trustscore`, usata per filtrare/ordinare le liste (`minTrust`, `sort=trust_desc`).

### 4.3 Parsing descrizioni (`/ai/parse-description`, `ai/descriptionParse.js`, protetto da `requireAuth`)
Estrazione di campi strutturati da testo libero (usata dall'auto-compilazione del form): `asset_type`, `cerco_vendo`, `from/to_location`, date e orari, `price`, `currency`, `is_named_ticket`, `gender`, `pnr`, `notes`. Prompt few-shot, output solo JSON, regola "non inventare: se non deducibile ⇒ null".

### 4.4 Traduzione annunci (`GET /api/listings/:id/translate?lang=xx`)
Traduzione titolo+descrizione via OpenAI (source auto-detect) con **cache su tabella `listing_translations`** (best-effort: se la tabella non esiste, traduce comunque).

### 4.5 API annunci (`/api/listings`)
CRUD annunci lato server: lista attivi con join TrustScore + filtro `minTrust` + ordinamenti + paginazione; dettaglio pubblico; creazione/aggiornamento con **PNR segregato nella tabella `listing_secrets`** (mai restituito dalle API); cancel (status→expired); soft delete.

### 4.6 Canale Facebook (funzionalità distintiva)
Webhook Meta (`/webhooks/facebook`) con verifica firma HMAC-SHA256 sul raw body, due casi d'uso:

**a) Ingest dal feed** — post e commenti dei gruppi/pagine FB vengono parsati dall'AI (`fbParser`) e trasformati in annunci (`fbIngest`):
- costruzione automatica di titolo/località/descrizione presentabili;
- dedup tramite upsert su `(source, external_id)`;
- link al post originale in `contact_url`;
- owner di sistema configurabile (`DEFAULT_LISTING_OWNER_ID`).

**b) Bot Messenger conversazionale** — flow guidato di pubblicazione in chat:
- postback `GET_STARTED` / menu (pubblica, riepilogo, annulla);
- quick replies per azione (CERCO/VENDO) e tipo (treno/hotel);
- estrazione AI dei campi dai messaggi liberi + merge con la sessione (`mergeParsed`);
- richiesta progressiva dei soli campi mancanti (`missingFields`, `nextPromptFor`);
- riepilogo formattato + conferma esplicita (✅ Conferma / ✏️ Modifica) prima della pubblicazione;
- sessioni persistite su DB (`fb_sessions`) con **TTL 24h**, normalizzazione IT→EN (treno→train), comandi testuali "riepilogo"/"annulla";
- endpoint `/simulate/facebook` (solo dev) per testare l'ingest senza Meta.

### 4.7 Endpoint di servizio
`/health`, `/dev/ping`, `/debug/env`, `/debug/supabase`, `/dev/token-check` (solo dev), mini-logger richieste in dev.

---

## 5. Modello dati ricostruito (Supabase / Postgres)

Ricostruito dalle query nel codice; i tipi sono dedotti.

### Tabelle

**`listings`** — annunci (cuore del sistema)
| Colonna | Note |
|---|---|
| `id` uuid PK | |
| `user_id` uuid NOT NULL | proprietario (FK `auth.users`/`profiles`) |
| `type` enum `listing_type` NOT NULL | `train` \| `hotel` (menzionato `flight`, non attivo) |
| `title` text NOT NULL | spesso auto-generato |
| `description` text | |
| `location` text NOT NULL | città hotel o "Roma → Milano" |
| `price` numeric NOT NULL, `currency` text (default EUR) | |
| `status` enum `listing_status` | `draft` \| `active` \| `paused` \| `sold` \| `exchanged` \| `archived` \| `expired` \| `deleted` \| `pending` \| `reserved` \| `swapped`; `active ⇄ paused` reversibile, `deleted` terminale |
| `cerco_vendo` text | `CERCO` \| `VENDO` |
| `route_from`, `route_to` text | solo treno |
| `depart_at`, `arrive_at` timestamp/date | solo treno |
| `check_in`, `check_out` date | solo hotel |
| `image_url` text | |
| `is_named_ticket` bool, `gender` text, `pnr` text | scritti dall'ingest FB ⚠️ (cfr. §7: il PNR dovrebbe stare solo in `listing_secrets`) |
| `trust_score` numeric | scritto dall'app alla creazione (ridondante con `trust_audit`) |
| `source`, `external_id`, `contact_url` | provenienza FB; **UNIQUE(source, external_id)** |
| `published_at`, `created_at` timestamptz | |

**`listing_secrets`** — dati riservati: `listing_id` FK, `pnr`. Mai esposta dalle API.

**`offers`** — proposte di acquisto/scambio
| Colonna | Note |
|---|---|
| `id` PK (uuid o int — le RPC `*_any` gestiscono entrambi) | |
| `type` | `buy` \| `swap` |
| `from_listing_id` | annuncio offerto (null per buy) |
| `to_listing_id` | annuncio richiesto |
| `proposer_id` uuid | chi propone |
| `amount` numeric, `currency` | solo buy |
| `message` text | |
| `status` | `pending` \| `accepted` \| `declined` \| `cancelled` \| `expired` \| `finalized` |
| `created_at` | |

**`profiles`** — profilo utente: `id` (= auth.users.id), `full_name`, altri campi anagrafici usati da `ProfileScreen`.

**`matches`** — risultati matching AI (pairwise): `user_id`, `from_listing_id`, `to_listing_id`, `score`, `model`, `explanation`, `created_at`. UNIQUE su `(from_listing_id, to_listing_id)`.

**`match_snapshots`** — snapshot aggregato per utente: `id`, `user_id`, `items` jsonb (array di `{fromListingId, toId, score, bidirectional, title, type, location, price, explanation, model, updatedAt}`), `generated_at`.

**`trust_audit`** — storico valutazioni TrustScore: `user_id`, `listing_id`, `trust_score`, `flags` jsonb, `suggested_fixes` jsonb, `sub_scores` jsonb, `raw` jsonb.

**`listing_translations`** — cache traduzioni: `listing_id`, `lang`, `title_translated`, `description_translated`.

**`fb_sessions`** — stato conversazioni Messenger: `sender_id`, dati sessione (json con `_ts` per il TTL applicativo).

### Viste e funzioni RPC

| Oggetto | Uso |
|---|---|
| `v_latest_trustscore` (view) | ultimo trust score per listing (`listing_id`, `trust_score`, `evaluated_at`) |
| `accept_offer_any(offer_id_text)` | accetta offerta (tollerante uuid/int) |
| `decline_offer_any(offer_id_text)` | rifiuta offerta |
| `get_my_pending_offer_any(...)` | offerta pending dell'utente su un listing |
| `list_my_active_listings()` | i miei annunci attivi (per lo swap) |
| `list_incoming_offers_any()` / `list_outgoing_offers_any()` | liste offerte con join, evitando mismatch di tipi |
| `fn_user_top_matches(p_user_id, p_top_per_listing)` | top match per utente calcolati in SQL |

---

## 6. Integrazioni e configurazione

### Variabili d'ambiente — server
| Variabile | Scopo |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | accesso DB con privilegi elevati |
| `OPENAI_API_KEY` | tutte le funzioni AI |
| `MATCH_AI_MODEL` (default `gpt-4o-mini`), `MATCH_AI_TEMP`, `MATCH_AI_TOP_P`, `MATCH_AI_BATCH`, `MATCH_AI_TIMEOUT_MS`, `MATCH_AI_CONCURRENCY`, `MATCH_AI_DETERMINISTIC`, `MATCH_AI_SEED_MODE`, `MATCH_INSERT_CHUNK` | tuning matching |
| `OPENAI_TRUST_MODEL` | modello per il TrustScore |
| `FB_VERIFY_TOKEN`, `FB_APP_SECRET`, `FB_PAGE_ACCESS_TOKEN` | webhook + Send API Messenger |
| `ALLOW_UNVERIFIED_WEBHOOK` | ⚠️ bypass verifica firma FB |
| `DEFAULT_LISTING_OWNER_ID` | owner degli annunci importati da FB |
| `CHAIN_CRON_SECRET` | secret condiviso (header `X-Cron-Secret`) per gli endpoint cron-only `/api/chains/recompute` e `/api/saved-searches/recompute`; fail-closed (503) se assente |
| `PORT` (default 8080), `NODE_ENV` | runtime |

### Variabili d'ambiente — app
| Variabile | Scopo |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | client Supabase |
| `EXPO_PUBLIC_API_BASE` | base URL del backend (`lib/backendApi.js` lancia un errore esplicito se assente, nessun fallback) |

---

## 7. Fix prioritari per andare in produzione

### P0 — Sicurezza (bloccanti) — ✅ tutti risolti

1. ✅ **Auth su `parse-description`** — `mountParseDescriptionRoute(app, [requireAuth, rateLimitParse])` in `index.js`: protetto dal vero middleware.
2. ✅ **Endpoint di traduzione con auth e rate limit** — `routes/translateListings.js` monta `requireAuth, rateLimitTranslate`.
3. ✅ **PNR mai più in chiaro nella tabella pubblica** — l'ingest Facebook scrive il PNR in `listing_secrets` (`models/fbIngest.js`), mai in `listings`; `lib/db.js` seleziona solo `LISTING_PUBLIC_COLUMNS` (mai `pnr`).
4. ✅ **Endpoint di debug solo in dev** — `/debug/env`, `/debug/supabase`, `/dev/*` sono ora montati dentro `if (isDev) { ... }`.
5. ✅ **`ALLOW_UNVERIFIED_WEBHOOK` vincolato a `NODE_ENV !== 'production'`** — il bypass della firma FB non è più possibile in produzione indipendentemente dal flag.
6. ✅ **CORS configurabile** — `origin: corsOrigins.length ? corsOrigins : true` (env `CORS_ORIGINS`); resta aperto solo se la variabile non è impostata.
7. ✅ **Migrazioni e policy RLS versionate** — schema, RLS, RPC e trigger vivono ora in `supabase/migrations/*.sql` (vedi `supabase/README.md`).

### P1 — Correttezza e robustezza

8. ✅ **`ReferenceError` risolto** — `models/matches.js` usa `s.model || process.env.MATCH_AI_MODEL || 'gpt-4o-mini'`, nessuna variabile `MODEL` indefinita.
9. ✅ **Router montati una sola volta** — `listingsRouter` su `/api/listings`, `matchesRouter` su `/api/matches`, ciascuno una sola volta.
10. ✅ **Fallback euristico collegato** — vedi §4.1.
11. ✅ **Offerte consolidate lato client** — non esistono più file offerte lato server (`offers.js`/`offers_lists_rpc.js`/`offers_v2_incoming_rpc.js`): l'app chiama direttamente le RPC Postgres (`lib/offers.js` → `accept_offer_any`/`decline_offer_any`, tolleranti uuid/int) o aggiorna `offers` via client con RLS.
12. ✅ **URL non più hardcoded** — `lib/api.js` non esiste più (sostituito da `lib/backendApi.js`, basato su `EXPO_PUBLIC_API_BASE`, lancia errore esplicito se assente); `lib/db.js` non contiene URL hardcoded.
13. **Rate limiter in-memory** (`middleware/rateLimit.js`): non sopravvive al riavvio né scala su più istanze; spostarlo su store condiviso (Postgres/Redis) resta da fare.
14. **Logging con dati personali** — da verificare sistematicamente; non riaudita in questo giro.
15. ✅ **Igiene repository** — `.gitignore` presente (`node_modules/`, `.env*`, build); nessun `node_modules` reale committato (i file `node_modules/` tracciati sono asset font del bundle web esportato, non dipendenze); rimossi `_backup_ui_refactor/`, doppia cartella `components/`, `assets/Untitled file.js`.

### P2 — Qualità e prodotto

16. ✅ **Test e CI presenti** — `server/test/` (96 test, `node --test`), pipeline `.github/workflows/node.js.yml` (push/PR su `main`, Node 20.x/22.x).
17. ✅ **Codice morto/duplicato rimosso** — vedi P1.15; route `parseTwo` consolidata in `ai/descriptionParse.js` (vedi §4.3).
18. ✅ **Migrazioni DB versionate** — vedi P0.7.
19. **TypeScript** — il tsconfig c'è ma il codice è ancora tutto JS; una migrazione graduale (prima `lib/`, poi screens) resta da fare.
20. **i18n** — ampiamente esteso rispetto all'analisi originale (dizionario it/en/es con centinaia di chiavi, parità verificata sistematicamente ad ogni modifica, vedi `docs/IMPROVEMENTS.md` sezione E); alcune stringhe fuori dizionario possono ancora esistere in aree non riauditate.
21. **Scope futuro accennato nel codice** — supporto `flight`, filtri di ricerca lato Home (oggi solo tab per tipo), notifiche push per nuovi match/offerte: da considerare nella roadmap.

---

## 8. Valutazione di maturità

Il progetto è un **MVP funzionante e sorprendentemente completo dal punto di vista funzionale** (4 casi d'uso AI reali + un canale di acquisizione via Facebook), con tutti i punti P0 (esposizione PNR, abuso di costi OpenAI, superfici di debug aperte) ormai risolti e coperti da test automatici e CI. Restano aperti solo alcuni P1/P2 di qualità/robustezza (rate limiter condiviso, migrazione TypeScript, logging dati personali da riverificare): la base è solida per una beta chiusa, e diverse aree sono già state oggetto di audit mirati (bug di codice/logici/edge case) documentati nella cronologia dei commit.
