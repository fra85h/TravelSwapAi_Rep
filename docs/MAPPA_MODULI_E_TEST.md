# TravelSwapAI — mappa dei moduli, endpoint e test

Inventario tecnico di cosa esiste nel repo oggi, a cosa serve ogni pezzo, e
cosa è (o non è) coperto da test automatici. Scritto per orientarsi, non per
sostituire la lettura del codice — ogni riga rimanda al file reale.

Complementari: `CLAUDE.md` (regole di dominio e workflow), `docs/
FUNCTIONAL_OVERVIEW.md` (analisi architetturale più narrativa, con lo stato
dei fix P0-P2), `docs/matching.md` (algoritmo di matching 1:1 in dettaglio),
`APP_OVERVIEW.md` (guida per chi usa l'app, non per chi la sviluppa).

---

## 1. Backend — endpoint HTTP (`server/src/routes/`)

| Metodo | Path | File | Protezione | Cosa fa |
|---|---|---|---|---|
| GET | `/health` | `index.js` | nessuna | Health check per Render. |
| GET/POST | `/webhooks/facebook` | `index.js` | firma Meta (bypass solo fuori produzione) | Verifica webhook + ricezione messaggi Messenger/Instagram, pubblica annunci via chat. |
| GET | `/api/listings` | `listing.js` | nessuna | Elenco annunci pubblici (Esplora). |
| GET | `/api/listings/:id` | `listing.js` | nessuna | Dettaglio annuncio. |
| POST | `/api/listings` | `listing.js` | requireAuth | Crea annuncio. |
| PATCH | `/api/listings/:id` | `listing.js` | requireAuth | Modifica annuncio. |
| POST | `/api/listings/:id/cancel` | `listing.js` | requireAuth | Elimina/annulla annuncio. |
| GET | `/api/listings/:id/price-check` | `priceCheck.js` | requireAuth + rate limit | Stima prezzo consigliato via AI. |
| GET | `/api/listings/:id/translate` | `translateListings.js` | requireAuth + rate limit | Traduzione on-demand nella lingua dell'utente, cache su DB. |
| POST | `/ai/trustscore` | `trustscore.js` | requireAuth + rate limit | Check AI: calcola il TrustScore (euristiche + AI testo + AI foto + moderazione). |
| POST | `/ai/parse-description` | `ai/descriptionParse.js` | requireAuth | "Compila con AI": estrae i campi da una descrizione libera. |
| POST | `/ai/parse-ticket-pdf` | `ai/descriptionParse.js` | requireAuth | Import da PDF del biglietto. |
| GET | `/api/matches/snapshot/ping` | `match.js` | nessuna | Health-check del sotto-sistema matching. |
| GET | `/api/matches/snapshot` | `match.js` | requireAuth | Legge lo snapshot dei match già calcolati. |
| POST | `/api/matches/snapshot/recompute` | `match.js` | requireAuth + rate limit | Ricalcola lo snapshot con l'euristica deterministica. |
| POST | `/api/matches/ai/recompute` | `match.js` | requireAuth + rate limit | Pipeline completa: scoring AI → snapshot → risposta. |
| POST | `/api/matches/propagate` | `match.js` | requireAuth + rate limit | Propaga un annuncio nei "Per te" di chi lo cerca. |
| POST | `/api/matches/retract` | `match.js` | requireAuth + rate limit | Ritira un annuncio dai suggerimenti altrui. |
| POST | `/api/chains/recompute` | `chains.js` | **cron-only** (secret) | Ricalcola gli swap a catena su tutta la piattaforma — pensato per girare ogni 15 min. |
| POST | `/api/saved-searches/recompute` | `savedSearches.js` | **cron-only** | Ricalcola i match per gli avvisi di ricerca. |
| POST | `/api/offers/recompute` | `offers.js` | **cron-only** | Scade le proposte pending oltre 48h (facoltativo: la scadenza pigra lato client basta già). |
| POST | `/api/pings` | `pings.js` | requireAuth + rate limit | Feature "Ping": segnala un proprio VENDO al proprietario di un CERCO (solo notifica, niente offerta). |
| POST | `/api/listing-questions` | `listingQuestions.js` | requireAuth + rate limit | Registra una domanda a risposta chiusa su un annuncio altrui. |
| POST | `/api/listing-questions/:id/answered` | `listingQuestions.js` | requireAuth + rate limit | Segna una domanda come risposta. |
| POST | `/api/fb-link/code` | `fbLink.js` | requireAuth + rate limit | Genera il codice per collegare l'account al bot Messenger. |
| POST | `/api/reports/notify` | `reportsNotify.js` | requireAuth + rate limit | Email "best effort" a chi modera quando arriva una segnalazione (già salvata via RLS lato client). |
| POST | `/api/notify/offer-received` | `notify.js` | requireAuth + rate limit | Email transazionale: hai ricevuto una proposta. |
| POST | `/api/notify/offer-accepted` | `notify.js` | requireAuth + rate limit | Email transazionale: la tua proposta è stata accettata. |
| GET | `/debug/*`, `/dev/*` | `index.js` | **solo fuori produzione** | Diagnostica (env, connessione Supabase, token). |

Tutti gli endpoint `cron-only` sono protetti da `requireCronSecret` (header
`X-Cron-Secret`), non dal login utente: nessuno di questi tre gira davvero da
solo se non è configurato un cron esterno (Render Scheduled Job o simile) —
non esiste nel repo.

---

## 2. Backend — modelli (`server/src/models/`)

| File | Cosa fa |
|---|---|
| `chains.js` | Motore di ricerca degli swap a catena: costruisce il grafo dei desideri (`buildDesireGraph`), trova cicli chiusi di 3 (`findThreeCycles`), propone via RPC `create_chain_proposal`. |
| `listings.js` | Query di lettura annunci (elenco pubblico, filtri, ordinamento — spostato in SQL per performance). |
| `matches.js` | Ricalcolo snapshot dei match 1:1 (euristico + AI), propagate/retract. |
| `savedSearches.js` | CRUD avvisi di ricerca + ricalcolo dei match che li soddisfano. |
| `listingQuestions.js` | Inserimento domanda pre-offerta (solo da qui, service-role, dopo validazione dominio) + notifica push al proprietario. |
| `pings.js` | Feature "Ping" — notifica diretta, nessuna transazione creata. |
| `fbIngest.js` | Riceve il testo/foto da Messenger, lo fa passare dal TrustScore, pubblica l'annuncio (o lo scarta se il punteggio è troppo basso). |
| `fbLink.js` | Genera/verifica il codice a 6 caratteri per collegare account TravelSwapAI ↔ utente Messenger. |
| `fbSessionStore.js` | Stato conversazionale per utente Messenger (`fb_sessions`), usato dal webhook per ricordare a che punto è l'ingest. |

---

## 3. Backend — AI e TrustScore (`server/src/services/trust/`, `server/src/ai/`)

| File | Cosa fa |
|---|---|
| `services/trust/heuristics.js` | Punteggio deterministico (0-100): coerenza, plausibilità (whitelist stazioni), completezza. Nessuna chiamata esterna. |
| `services/trust/aiTrust.js` | Chiamata OpenAI per il punteggio "testo" + eventuale analisi foto; fallback su euristiche se la chiave manca o la chiamata fallisce. |
| `services/trust/computeTrustScore.js` | Orchestratore: fonde euristiche + AI testo + AI foto (pesi 45/45/10), applica i tetti (`applyTrustCaps`) per flag gravi, decide `verificationPending` se l'AI non ha risposto. |
| `services/trust/falseClaims.js` | Backstop deterministico contro le affermazioni FALSE dell'AI ("manca X" quando X c'è, tratta/durata messe in dubbio quando sono plausibili, data futura usata come motivo). |
| `services/trust/moderation.js` | Moderazione contenuti (OpenAI Moderations) **solo sugli annunci in creazione** — non sui messaggi di chat. |
| `services/trust/store.js` | Scrive la riga di audit (`trust_audit`) che alimenta lo storico del punteggio. |
| `services/trust/translate/openaiProvider.js` | Traduzione di un annuncio in una lingua target via AI. |
| `ai/score.js` | Matching 1:1: punteggio strutturale AI (`scoreWithAI`) + fallback euristico (`heuristicScore`). Vedi `docs/matching.md`. |
| `ai/chainMatch.js` | Normalizzazione fuzzy per gli swap a catena: quanto un annuncio VENDO soddisfa un CERCO, tollerando città vicine e date non identiche. |
| `ai/chainExplain.js` | Spiegazione in linguaggio naturale di una catena trovata (fallback a un template se l'AI non risponde). |
| `ai/descriptionParse.js` | Parsing AI di una descrizione libera o di un PDF biglietto nei campi strutturati dell'annuncio. |
| `ai/priceCheck.js` | Stima del prezzo consigliato in base a tratta/date/tipo. |

---

## 4. Backend — middleware e librerie di supporto

| File | Cosa fa |
|---|---|
| `middleware/requireAuth.js` | Verifica il JWT Supabase, popola `req.user`. |
| `middleware/requireCronSecret.js` | Fail-closed (503) se l'header `X-Cron-Secret` manca o non combacia — protegge gli endpoint di ricalcolo periodico. |
| `middleware/rateLimit.js` | Rate limiter **in-memory** (non sopravvive al riavvio, non scala su più istanze — nota aperta, vedi §10). |
| `lib/concurrency.js` | `mapWithConcurrency`: esegue una lista di chiamate (tipicamente OpenAI) con un tetto di parallelismo, non tutte in fila né tutte insieme. |
| `lib/envNumber.js` | Legge un intero da env senza il trabocchetto `Number(x || default)` su stringa vuota. |
| `lib/openaiClient.js` | Factory del client OpenAI: costruito solo se la chiave è presente (altrimenti il costruttore stesso farebbe cadere il server all'avvio). |
| `lib/push.js` | Invio push Expo — no-op silenzioso finché nessun client nativo registra un token. |
| `lib/mailer.js` | Invio email SMTP — no-op con warning se non configurato. |
| `lib/fbSend.js` | Send API di Messenger/Instagram (Page Access Token). |
| `lib/webhookPlatform.js` | Mappa `object` del payload webhook Meta → piattaforma interna (`page`→messenger, `instagram`→instagram). |
| `lib/messengerPublishOutcome.js` | Decide il messaggio di risposta e se svuotare la sessione, dato l'esito della pubblicazione da Facebook. |
| `lib/announceRules.js` | Unisce lo stato precedente della conversazione Messenger col nuovo parse AI. |

---

## 5. Database — le RPC Postgres principali, per dominio

Nessun ORM: tutta la logica di scrittura critica vive in funzioni Postgres
(`supabase/migrations/*.sql`), applicate **a mano** (vedi `CLAUDE.md`).

- **Ciclo di vita offerta 1:1**: `accept_offer_any`, `decline_offer_any`,
  `confirm_exchange_any` (doppia conferma), `cancel_accepted_offer_any`,
  `report_exchange_problem`, `release_my_stale_reservations` (timeout 7gg),
  `expire_old_offers`.
- **Swap a catena**: `create_chain_proposal`, `confirm_chain_participant`,
  `decline_chain_participant`, `expire_old_chain_proposals`.
- **Valutazioni**: `rate_transaction`, `get_user_rating` (filtra i voti non
  ancora rivelati — double-blind), `my_rating_for_offer`.
- **Chat**: `mark_chat_read`, `list_my_chats` (1:1); `mark_chain_chat_read`,
  `list_my_chain_chats` (catena, aperta solo a `completed`).
- **Trigger di sistema su `listings`**: `enforce_active_listing_cap` (max 10
  attivi), `before_insert_listings_block_duplicate`,
  `before_update_listings_lock_terminal` (blocca modifiche a stati conclusi),
  `before_update_listings_lock_columns`, `update_listing_trust_score`
  (propaga il punteggio dall'ultimo audit), `expire_my_stale_listings`.
- **Domande pre-offerta**: tabella `listing_questions`, insert solo da
  `models/listingQuestions.js` (service-role).

Le funzioni riscritte più volte nella storia del progetto (`accept_offer_any`,
`confirm_exchange_any`, `before_insert_offers_enforce`) hanno test di
regressione dedicati — vedi §8.

---

## 6. App mobile — schermate (`travelswap_ai/travelswapai/screens/`)

| Schermata | Cosa fa |
|---|---|
| `HomeScreen.js` | Esplora: elenco annunci pubblici + sezione "Per te" (suggerimenti). |
| `CreateListingScreen.js` | Creazione **e** modifica annuncio (stesso file, `mode`): import automatico (QR/PDF/PNR/testo), "Compila con AI", Check AI, pubblicazione. Il file più grande dell'app (~3000 righe). |
| `ListingDetailScreen.js` | Dettaglio annuncio, azioni (proponi, contatta il venditore). |
| `OfferFlow.js` | Flusso guidato per proporre un acquisto o uno scambio. |
| `OfferDetailScreen.js` | Dettaglio di una singola proposta. |
| `ChatScreen.js` | Chat 1:1 di un'offerta accettata: doppia conferma, dispute, valutazione a stelle. |
| `ChainProposalsScreen.js` | Vedi/conferma/rifiuta le proposte di scambio a 3. |
| `ChainChatScreen.js` | Chat tra i 3 partecipanti di uno swap a catena **concluso**. |
| `AttivitaScreen.js` | Casella unica: da fare, in attesa, chat (1:1 e catena unite), trovati dagli avvisi, storico, scadute. |
| `MainTabs.js` | Tab bar principale (Esplora / Vendi / Attività / Profilo) + badge/icona dinamica. |
| `ProfileScreen.js` | Profilo utente, i propri annunci, azioni (pausa/riprendi/elimina/modifica). |
| `SellerProfileScreen.js` | Profilo pubblico di un venditore (stelle, annunci attivi). |
| `EditProfileScreen.js` | Modifica dati profilo. |
| `SavedScreen.js` | Preferiti. |
| `SavedSearchesScreen.js` | Avvisi di ricerca salvati + risultati trovati. |
| `MatchingScreen.js` | Suggerimenti AI (match 1:1) a schermo intero. |
| `NotificationsScreen.js` | Centro notifiche. |
| `LinkMessengerScreen.js` | Collega l'account al bot Messenger (mostra il codice). |
| `LoginScreen.js` / `ForgotPasswordScreen.js` / `ResetPasswordScreen.js` / `OAuthCallbackScreen.js` | Autenticazione. |
| `OnboardingScreen.js` | Carosello di presentazione al primo avvio. |
| `PreferencesOnboardingScreen.js` | Preferenze di ricerca subito dopo la registrazione. |

---

## 7. App mobile — librerie di supporto (`travelswap_ai/travelswapai/lib/`)

Raggruppate per area (elenco completo, non ripeto ciò che il nome già dice
chiaramente — `theme.js`, `number.js`, `polyfills.js`):

- **Dati/rete**: `supabase.js`, `db.js`, `backendApi.js`.
- **Offerte e scambi**: `offers.js` (RPC 1:1), `chains.js` (RPC catena),
  `chat.js` / `chainChat.js` (le due chat, fonti separate).
- **Valutazioni**: `ratingsApi.js` (RPC), `ratingDisplay.mjs` (pure, regole
  di visualizzazione — testato dalla CI senza bundler).
- **Domande pre-offerta**: `listingQuestions.mjs` (catalogo, pure),
  `listingQuestionsApi.js` (RPC).
- **Annunci**: `listingImages.js`, `listingStatus.js`, `listingTitle.js`,
  `descriptionParser.js`, `trainStations.mjs` (whitelist stazioni, pure),
  `textPatterns.mjs` (rilevamento "due annunci in uno", pure).
- **Check AI**: `useTrustScore.js`, `trustRetry.js` (ritenta i check rimasti
  pending), `usePriceCheck.js`, `useListingTranslation.js`.
- **Attività/notifiche**: `activity.js`, `ActivityContext.js`,
  `notifications.js`, `NotificationsContext.js`, `pushRegistration.js`.
- **Altro**: `auth.js`, `avatar.js`, `preferences.js`, `savedListings.js`,
  `savedSearches.js`, `transactions.js`, `reports.js`, `fbLink.js`,
  `webAlert.js`, `i18n/` (dizionari it/en/es).

I file `.mjs` (non `.js`) sono quelli condivisi tra app e CI backend: logica
pura, nessuna dipendenza React Native, importabile da Node senza bundler —
è così che finiscono nei test automatici nonostante vivano nel progetto RN.

---

## 8. Copertura test — cosa è testato davvero (`server/test/`, 27 file)

Raggruppati per area:

- **Matching 1:1**: `heuristicScore.test.js`, `heuristicScoreFromListing.test.js`,
  `heuristicSwap.test.js`, `matchBudgetDate.test.js`, `fuseTrustScore.test.js`.
- **Swap a catena**: `chains.test.js`, `chainExplain.test.js`,
  `heuristicChainScore.test.js`.
- **TrustScore / Check AI**: `heuristics.test.js`, `trustCaps.test.js`,
  `cleanTextReason.test.js`, `falseClaims.test.js`,
  `computeTrustScoreDuration.test.js`, `railCities.test.js`.
- **Facebook/Messenger**: `fbIngestTrustGate.test.js`, `fbLink.test.js`,
  `messengerPublishOutcome.test.js`, `webhookPlatform.test.js`,
  `announceRules.test.js`.
- **Valutazioni**: `ratingDisplay.test.js`.
- **Domande pre-offerta**: `listingQuestions.test.js`.
- **Avvisi di ricerca**: `savedSearches.test.js`.
- **Utility pure**: `textPatterns.test.js`, `translatePlaceholders.test.js`,
  `envNumber.test.js`, `concurrency.test.js`.
- **Regressione sulle migration SQL**: `migrationsIntegrity.test.js` — non
  esegue query (niente DB in CI): controlla che l'**ultima** versione di ogni
  funzione riscritta più volte contenga ancora le correzioni introdotte in
  precedenza (lock, cast, ordine). Vedi `CLAUDE.md` per la regressione reale
  che l'ha motivato.

**281 test**, tutti eseguiti con `cd server && node --test`, nessuna rete
reale (OpenAI/Supabase non sono raggiungibili in CI: dove serve, si testa il
percorso di fallback deterministico).

### Cosa NON è testato automaticamente

- **Nessuna schermata React Native**: zero test su componenti/hook/JSX. Solo
  la logica **pura** estratta in `.mjs` (sopra) è testata — tutto il resto
  dell'app (stato, navigazione, rendering) ha solo un parse-check sintattico
  (`@babel/parser`), non una verifica di comportamento.
- **Nessuna query SQL eseguita davvero**: `migrationsIntegrity.test.js`
  legge il *testo* delle migration con regex, non apre mai una connessione
  Postgres. Un bug di logica in una RPC che rispetta comunque i pattern
  cercati (lock presente, cast presente) non verrebbe scoperto qui.
- **Nessun test di integrazione HTTP** (tipo supertest): le route non sono
  mai chiamate come endpoint, solo le funzioni pure sottostanti.
- **Nessun E2E** (Playwright/Detox) su app mobile o bundle web.
- **Nessuna chiamata OpenAI reale testata**: sempre il fallback deterministico.

---

## 9. Rischi noti / cosa manca (non bug, scelte o limiti da conoscere)

- **Rate limiter in-memory**: non sopravvive al riavvio del server, non
  scala su più istanze Render.
- **Nessun escrow**: il pagamento avviene fuori app (bonifico/PayPal/
  contanti); la chat non modera le richieste di pagamento, solo un avviso
  testuale fisso.
- **PNR non verificabile**: solo un controllo di formato plausibile, nessuna
  API pubblica Trenitalia/Italo per confermare che esista davvero.
- **Recensioni**: nessuna verifica anti-collusione tra account della stessa
  persona (limite strutturale di un sistema di reputazione senza verifica
  d'identità); coprono solo gli scambi 1:1, non ancora gli scambi a 3.
- **Nessun cron reale nel repo**: gli endpoint `cron-only` (chains/saved-
  searches/offers recompute) richiedono un job esterno configurato su
  Render — verificare che esista e giri davvero.
- **TypeScript**: `tsconfig` presente ma il codice è ancora tutto JS.
- Vedi anche `docs/FUNCTIONAL_OVERVIEW.md` §7 per l'elenco P0-P2 completo.

---

## 10. Come testare in pratica

```bash
# Suite completa backend (281 test)
cd server && node --test

# Sintassi di un singolo file server dopo una modifica
node --check server/src/percorso/del/file.js

# Parse-check di un file React Native (JSX) — non esegue, verifica solo la sintassi
node -e "require('@babel/parser').parse(require('fs').readFileSync('<file>','utf8'),{sourceType:'module',plugins:['jsx']})"

# Parità delle traduzioni it/en/es (stesso numero di chiavi in tutte e 3)
cd travelswap_ai/travelswapai && node -e "
const t=require('./lib/i18n/translations.js');const T=t.default||t.translations||t;
function flat(o,p=''){let k=[];for(const key in o){const v=o[key];const np=p?p+'.'+key:key;if(v&&typeof v==='object'&&!Array.isArray(v))k=k.concat(flat(v,np));else k.push(np);}return k;}
const langs=Object.keys(T).filter(l=>T[l]&&typeof T[l]==='object');
const sets=langs.map(l=>new Set(flat(T[l])));
langs.forEach((l,i)=>console.log(l,sets[i].size));
"

# Ricompilare il bundle web dopo una modifica client (poi grep debug-user/DEBUG_MOCK deve dare 0)
cd travelswap_ai/travelswapai && EXPO_OFFLINE=1 npx expo export --platform web --output-dir ../../server/public/app
```

### Test manuale dei flussi critici (nessun test automatico li copre)

Con due utenti di prova (due account distinti), nell'ordine in cui un vero
scambio li attraversa:

1. **Pubblicazione**: crea un annuncio VENDO completo (tutti i campi
   obbligatori), verifica che il Check AI parta da solo e che "Pubblica" ti
   riporti alla schermata giusta se manca qualcosa.
2. **Offerta**: dall'altro account, proponi acquisto o scambio; verifica che
   compaia in "Attività" del proprietario.
3. **Accettazione**: accetta la proposta; verifica che l'annuncio passi a
   `reserved` e che si apra la chat.
4. **Doppia conferma**: conferma da un solo lato (deve restare "in attesa"),
   poi dall'altro (deve chiudersi, con storico aggiornato).
5. **Valutazione**: verifica che la richiesta a stelle compaia solo a
   scambio concluso, e che il voto dell'altra parte resti nascosto finché
   non vota anche lei.
6. **Scambio a 3**: il più difficile da testare a mano (serve l'incastro
   reale di 3 utenti/annunci, oppure aspettare il ricalcolo automatico ogni
   15 min con dati di prova già coerenti) — verifica almeno che, con tre
   account e annunci compatibili già pubblicati, la proposta compaia dopo il
   ricalcolo (`POST /api/chains/recompute` con il secret, se vuoi forzarlo
   subito invece di aspettare).
7. **Cancellazione**: annulla uno scambio accettato da un lato, verifica che
   l'annuncio torni `active` per entrambi.
