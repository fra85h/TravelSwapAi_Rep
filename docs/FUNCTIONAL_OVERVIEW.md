# TravelSwap — Analisi funzionale (reverse engineering)

> Documento ricavato dall'analisi del codice sorgente (app mobile + server).
> Data analisi: luglio 2026.

---

## 1. Scope e visione del prodotto

**TravelSwap è un marketplace peer-to-peer per rivendere o scambiare prenotazioni di viaggio non utilizzate.** Gli asset attualmente supportati sono due:

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
│       ├── routes/              # listing, match, trustscore, translateListings, offers, chains, savedSearches, pings, fbLink, notify, reportsNotify, reportActions, disputes, priceCheck
│       ├── ai/                  # score.js (matching AI), descriptionParse.js, chainMatch.js, chainExplain.js, priceCheck.js
│       ├── services/trust/      # heuristics, aiTrust, store, translate
│       ├── parsers/fbParser.js  # Estrazione campi da testi Facebook
│       ├── models/              # listings, matches, fbIngest, fbSessionStore, chains, fbLink, pings, savedSearches, listingQuestions, reportActionTokens
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

### 3.6 Swap a catena, valutazioni, domande pre-offerta
- **Swap a 3** (`server/src/models/chains.js`, `ai/chainMatch.js`, `ai/chainExplain.js`): trova cicli chiusi di 3 utenti tra gli annunci attivi (`findAndProposeChains`, cron-only `POST /api/chains/recompute`, ogni 15 min). Un utente con più annunci VENDO attivi partecipa comunque: ogni arco del grafo di desiderio sceglie l'annuncio specifico con punteggio migliore (non esclude l'utente, comportamento della v1). Si chiude con `confirm_chain_participant` (lock ordinato sui 3 annunci prima di riservarli) solo quando tutti e 3 confermano; da quel momento chat dedicata (`chain_messages`, RLS aperta solo a catena `completed`).
- **Valutazioni 1-5 stelle** (`transaction_ratings`, RPC `rate_transaction`/`get_user_rating`): solo per scambi 1:1 (i chain-swap non hanno una riga in `offers`, quindi non sono ancora votabili). Doppio cieco — voto nascosto finché anche l'altra parte vota o passano 14 giorni — e immutabile.
- **Domande a risposta chiusa pre-offerta** (`lib/listingQuestions.mjs`): catalogo treno/hotel mostrato prima di proporre un'offerta, per ridurre lo scambio di contatti fuori app in chat.
- **Race condition corrette** (`supabase/migrations/20260726120000`, `20260729120000`): lock ordinato su `accept_offer_any`/`confirm_exchange_any`/`confirm_chain_participant` e ricontrollo di stato in `release_my_stale_reservations`, per evitare che una pulizia lazy o una conferma concorrente sovrascrivano uno scambio appena concluso.


### 3.7 Dopo l'accettazione: passaggi guidati e denaro dichiarato
- **"Cosa fare adesso"** (`TransactionStepsScreen`, ingresso dalla chat sulla proposta accettata): sequenza verticale dei passaggi che restano, **uno solo espanso per volta**, con quanti ne mancano dichiarato in testa e il **turno attribuito** a ogni tappa (tu / loro / entrambi). Nasce da un buco reale: i passaggi che rendono davvero effettivo uno scambio avvengono FUORI dall'app (reintestazione presso l'operatore, eventuale pagamento) e non erano scritti da nessuna parte — dopo la conferma si tornava in chat con una riga di stato.
- La sequenza **non è nel JSX**: la costruisce `lib/transactionSteps.js`, modulo puro che deriva i passaggi dallo stato dell'handshake e restituisce identificatori e parametri (nessun testo per l'utente: le stringhe le risolve la schermata via i18n). Il passo del denaro porta un `variant` — oggi `external`, domani `escrow` — così l'introduzione di un pagamento in custodia è una riga di dati, non una schermata da riscrivere.
- Regole che discendono dal modello: in uno **scambio il passo del denaro non esiste** (biglietto contro biglietto, fra le parti non gira denaro — un importo lì sarebbe un conguaglio che `offers` non prevede); pagamento e cambio nominativo **non si spuntano da soli** perché avvengono fuori dall'app e non sono osservabili (si considerano superati solo quando la conferma li rende irrilevanti); con una **contestazione aperta** tutto il resto è bloccato, coerentemente col DB (`confirm_exchange` si ferma su `disputed_at`).
- **Dichiarazione del pagamento** (`payment_declarations`, RPC `declare_payment` / `get_payment_declarations`): solo negli acquisti, ciascuna parte registra importo, metodo e data di ciò che dichiara di aver pagato o incassato. **Non è un vincolo**: non blocca né abilita nulla, la transazione resta governata dalla sola conferma reciproca. Serve a sapere cosa succede davvero fuori dall'app — importi, metodi, tempi, quanto spesso le due versioni divergono — cioè i numeri su cui decidere se un pagamento in custodia vale il suo costo.
- **Doppio cieco**, come per le valutazioni: il contenuto della dichiarazione altrui è visibile solo dopo aver fatto la propria (saperlo prima permetterebbe di allinearsi, e il dato perderebbe il suo unico pregio: essere indipendente sui due lati). Che l'altro *abbia* dichiarato si vede subito. Metodo a **elenco chiuso** (bonifico/PayPal/Satispay/Revolut/contanti/altro), mai testo libero: un campo libero diventerebbe il posto dove si scrivono IBAN e numeri di telefono. Nessun identificativo di pagamento viene registrato.
- **Posizionamento**: l'app **non gestisce pagamenti e non custodisce denaro**. Il copy dice "oggi TravelSwap non gestisce pagamenti", mai una promessa perpetua: trattenere denaro di terzi in futuro comporta obblighi regolatori, e una frase di oggi non deve diventare una promessa tradita.

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

### 4.3 Parsing descrizioni (`/ai/parse-description`, `/ai/parse-ticket-pdf`, `ai/descriptionParse.js`, protetti da `requireAuth`)
Estrazione di campi strutturati (usata da "Compila con AI", import PDF biglietto e import da conferma incollata — stesso prompt/schema per tutti e tre): `cercoVendo`, `type`, `title` (standardizzato, mai con prezzo/data), `origin`/`destination`/`route` (arrow ASCII `"-->"`), `location`, `checkIn`/`checkOut` (hotel) o `departAt`/`arriveAt` (treno, con rollover al primo anno futuro se manca l'anno), `price`, `isNamedTicket`, `gender`, `pnr`, `imageUrl`, `provider`. Output JSON strutturato (`json_schema` strict), tutte le chiavi sempre presenti, regola "non inventare: se non deducibile ⇒ null".

`provider` (mappato su `listings.operator` lato app) viene dedotto in due casi: testo chiaramente una conferma di prenotazione con fornitore esplicito, oppure — solo per i treni — un marchio commerciale esclusivo di un operatore (Frecciarossa/Frecciargento/Freccia Bianca/Intercity/Intercity Notte/EuroCity/Euronight → Trenitalia; Italo → Italo) anche senza nominare l'azienda. `Regionale`/`Regionale Veloce` restano volutamente esclusi (gestiti da più aziende diverse per regione).

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

### 4.7 Segnalazioni e moderazione (`reports`, `POST /api/reports/notify`, `routes/reportActions.js`)
L'utente segnala un annuncio/venditore (`reports`, insert diretto via RLS dal client, un motivo tra `fake`/`scam`/`inappropriate`/`duplicate`/`other`). Il client chiama poi `/api/reports/notify` (best-effort, fire-and-forget) per avvisare via email chi modera (`REPORT_NOTIFY_TO`). Se la segnalazione ha un annuncio associato, l'email include anche due link "un click" — **metti in pausa** / **elimina** l'annuncio segnalato — protetti da un token monouso con scadenza 7 giorni (`report_action_tokens`, `models/reportActionTokens.js`). Il click apre una pagina di conferma HTML servita dal server (`GET /api/report-actions/:token`, pubblica, nessun login: l'autorizzazione è il possesso del link); solo il submit del bottone (`POST /api/report-actions/:token/confirm`) consuma il token ed esegue davvero l'azione (`models/listings.js` → `moderatorSetListingStatus`, nessun `userId` proprietario richiesto). Separare GET da POST evita che un client email o uno scanner che pre-carica i link scateni l'azione da solo — rischio concreto per "elimina", stato terminale per un annuncio. Nessuna dashboard admin in-app: la moderazione oggi passa solo da questa email o dal Table Editor di Supabase.

### 4.8 Prezzo dinamico (`POST /api/price-decay/recompute`, `models/priceDecay.js`)
Un annuncio VENDO vale il prezzo pieno fino a un attimo prima della partenza/check-in, poi vale zero — a differenza di un marketplace generico qui il "deperimento" è certo e calcolabile. Il venditore può attivare, per singolo annuncio (mai per un CERCO: lì `price` è un budget, non un prezzo di vendita), uno sconto automatico: `price` decade linearmente da `list_price` (il prezzo di partenza, riancorato ad ogni salvataggio col toggle attivo) fino a `price_floor` (il minimo, mai superato), negli ultimi `PRICE_DECAY_WINDOW_DAYS` giorni (default 7) prima di `depart_at`/`check_in`. Un cron periodico (stesso schema di catene/avvisi/scadenza offerte, protetto da `X-Cron-Secret`) aggiorna **solo** `price` — tutto il resto (matching, offerte, card) continua a leggerlo come oggi — e notifica il venditore in-app (`listing_price_dropped`) ad ogni scatto. Il decadimento è monotono per costruzione: il nuovo prezzo è sempre `min(prezzo corrente, target calcolato)`, non un aumento, anche se `list_price` fosse disallineata.

### 4.9 Endpoint di servizio
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
| `operator` text | solo treno; mai chiesto a mano, ricavato solo da "Compila con AI"/import PDF/import da conferma (cfr. §4.3); mostrato solo nel dettaglio annuncio, mai nelle card di Esplora |
| `dynamic_pricing_enabled` bool, `price_floor` numeric, `list_price` numeric | prezzo dinamico (cfr. §4.8), solo VENDO — `list_price` è il prezzo di partenza della curva, `price_floor` il minimo mai superato |
| `trust_score` numeric | scritto dall'app **solo alla creazione**; in modifica è scrivibile unicamente dalla pipeline server-side (trigger `update_listing_trust_score` su `trust_audit`, dentro la finestra `app.sync_trust_score`), e `before_update_listings_lock_columns` scarta qualunque valore arrivato dal client. `before_update_listings_invalidate_trust` lo azzera quando cambia il contenuto (titolo, descrizione, tipo, prezzo, località, tratta, date, foto): per questo in modifica il Check AI parte **dopo** il salvataggio, così il punteggio è l'ultima scrittura e descrive il contenuto pubblicato |
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

**`payment_declarations`** — cosa le due parti dichiarano di aver pagato/incassato fuori dall'app: `offer_id` FK, `user_id` FK, `role` (`buyer`\|`seller`, derivato dal DB, mai dal client), `amount`, `currency`, `method` (elenco chiuso), `paid_at`, UNIQUE`(offer_id, user_id)`. Dato di **osservazione, non vincolo**: non blocca né abilita alcun passaggio. RLS in lettura solo sulle proprie righe, nessuna policy di scrittura (si passa unicamente dalle RPC). Vedi §3.7.

**`report_action_tokens`** — token "un click" (pausa/elimina) inviati nell'email di notifica segnalazione: `token` text PK, `report_id`/`listing_id` FK, `action` (`pause`\|`delete`), `expires_at` (7gg), `used_at`. Service-role only (RLS abilitata, nessuna policy), stesso pattern di `fb_link_codes`. Vedi §4.7.

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
| `my_offer_role(p_offer_id)` | `buyer`/`seller` dell'utente corrente su un acquisto (null su uno scambio: lì non esistono i due ruoli). `get_offer_handshake` non espone il ruolo, e senza di esso il turno del pagamento resta volutamente non attribuito |
| `declare_payment(p_offer_id, p_amount, p_method, p_paid_at)` | registra/corregge la propria dichiarazione di pagamento (solo acquisti accettati o conclusi) |
| `get_payment_declarations(p_offer_id)` | le due dichiarazioni con la regola del doppio cieco |

---

## 6. Integrazioni e configurazione

### Variabili d'ambiente — server
| Variabile | Scopo |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | accesso DB con privilegi elevati |
| `OPENAI_API_KEY` | tutte le funzioni AI |
| `MATCH_AI_MODEL` (default `gpt-4o-mini`), `MATCH_AI_TEMP`, `MATCH_AI_TOP_P`, `MATCH_AI_BATCH`, `MATCH_AI_TIMEOUT_MS`, `MATCH_AI_CONCURRENCY`, `MATCH_AI_DETERMINISTIC`, `MATCH_AI_SEED_MODE`, `MATCH_INSERT_CHUNK` | tuning matching |
| `OPENAI_TRUST_MODEL` (default `gpt-4.1`) | modello per il TrustScore. Come l'analisi prezzo parte da un modello di punta: qui non si estrae un campo, si dà un giudizio su cosa è plausibile e cosa somiglia a una truffa, testo e foto insieme — ed è la funzione con le conseguenze più visibili quando sbaglia. **Deve supportare la visione** (le immagini viaggiano come `image_url`, `detail: "low"`) |
| `OPENAI_PRICE_MODEL` (default `gpt-4.1`) | modello per l'analisi prezzo. È l'unica funzione AI che parte da un modello di punta invece che dal "mini": non estrae né classifica, deve *sapere* quanto vale una tratta in un certo periodo — conoscenza del mondo e giudizio, dove il divario tra i due tier è massimo. Costa poco alzarlo perché è una chiamata sola con prompt breve, al contrario del matching (`MATCH_AI_MODEL`), che resta apposta sul modello economico avendo il volume di token più alto e il compito più ristretto |
| `CHAIN_AI_MODEL` | modello per gli scambi a 3 (`chainMatch`/`chainExplain`); se assente ricade su `MATCH_AI_MODEL` |
| `FB_VERIFY_TOKEN`, `FB_APP_SECRET`, `FB_PAGE_ACCESS_TOKEN` | webhook + Send API Messenger |
| `ALLOW_UNVERIFIED_WEBHOOK` | ⚠️ bypass verifica firma FB |
| `DEFAULT_LISTING_OWNER_ID` | owner degli annunci importati da FB |
| `CHAIN_CRON_SECRET` | secret condiviso (header `X-Cron-Secret`) per gli endpoint cron-only `/api/chains/recompute`, `/api/saved-searches/recompute`, `/api/offers/recompute` e `/api/price-decay/recompute`; fail-closed (503) se assente |
| `PRICE_DECAY_WINDOW_DAYS` (default `7`) | ampiezza in giorni della finestra di sconto automatico del prezzo dinamico (cfr. §4.8) prima di `depart_at`/`check_in` |
| `ADMIN_ACTION_SECRET` | secret condiviso (header `X-Admin-Secret`, distinto da `CHAIN_CRON_SECRET`) per azioni amministrative manuali — `/api/disputes/resolve` (contestazione 1:1 aperta da `report_exchange_problem`) e `/api/disputes/resolve-chain` (contestazione su uno scambio a 3), nessun concetto di ruolo admin nel DB; fail-closed (503) se assente |
| `RESEND_API_KEY`, `RESEND_FROM` | email di servizio via API HTTPS di Resend (`server/src/lib/mailer.js`) — offerta ricevuta/accettata (`routes/notify.js`) e notifica segnalazioni (`routes/reportsNotify.js`); se `RESEND_API_KEY` assente `mailerConfigured()` è `false` e ogni invio è un no-op silenzioso (nessuna feature si rompe, l'email semplicemente non parte). Sostituisce le vecchie `SMTP_*` (nodemailer): Render blocca l'SMTP in uscita su entrambe le porte comuni (465/587), quindi serve un trasporto HTTPS. Il dominio di test `onboarding@resend.dev` (default di `RESEND_FROM` se non impostato) consegna solo al proprio indirizzo verificato su Resend — per mandare a utenti reali serve un dominio proprio verificato (Dashboard Resend → Domains, record SPF/DKIM) |
| `REPORT_NOTIFY_TO` | indirizzo che riceve l'email quando arriva una nuova segnalazione (`/api/reports/notify`) — senza questa variabile (o senza Resend configurato) la segnalazione resta comunque salvata nella tabella `reports`, ma nessuno viene avvisato: va controllata a mano nel Table Editor di Supabase (non esiste ancora una schermata admin in-app). L'email include anche due link "un click" (pausa/elimina l'annuncio segnalato, con pagina di conferma), generati da `models/reportActionTokens.js` — token monouso valido 7 giorni, vedi migrazione `20260731100000_report_action_tokens.sql` |
| `PUBLIC_BASE_URL` (default `https://travelswap.app`) | dominio pubblico usato per costruire i link pausa/elimina nell'email di segnalazione (`routes/reportsNotify.js`) — non derivato da `req.protocol`/`req.get('host')` perché dietro il proxy di Render non è affidabile senza `trust proxy` |
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

16. ✅ **Test e CI presenti** — `server/test/` (332 test, `node --test`), pipeline `.github/workflows/node.js.yml` (push/PR su `main`, Node 20.x/22.x).
17. ✅ **Codice morto/duplicato rimosso** — vedi P1.15; route `parseTwo` consolidata in `ai/descriptionParse.js` (vedi §4.3).
18. ✅ **Migrazioni DB versionate** — vedi P0.7.
19. **TypeScript** — il tsconfig c'è ma il codice è ancora tutto JS; una migrazione graduale (prima `lib/`, poi screens) resta da fare.
20. **i18n** — ampiamente esteso rispetto all'analisi originale (dizionario it/en/es con centinaia di chiavi, parità verificata sistematicamente ad ogni modifica, vedi `docs/IMPROVEMENTS.md` sezione E); alcune stringhe fuori dizionario possono ancora esistere in aree non riauditate.
21. **Scope futuro accennato nel codice** — supporto `flight`, filtri di ricerca lato Home (oggi solo tab per tipo), notifiche push per nuovi match/offerte: da considerare nella roadmap.

---

## 8. Valutazione di maturità

Il progetto è un **MVP funzionante e sorprendentemente completo dal punto di vista funzionale** (4 casi d'uso AI reali + un canale di acquisizione via Facebook), con tutti i punti P0 (esposizione PNR, abuso di costi OpenAI, superfici di debug aperte) ormai risolti e coperti da test automatici e CI. Restano aperti solo alcuni P1/P2 di qualità/robustezza (rate limiter condiviso, migrazione TypeScript, logging dati personali da riverificare): la base è solida per una beta chiusa, e diverse aree sono già state oggetto di audit mirati (bug di codice/logici/edge case) documentati nella cronologia dei commit.
