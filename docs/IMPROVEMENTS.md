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

### D3. Avvisi di ricerca ("price/route alert")
"Avvisami quando compare un treno Roma→Milano sotto 40€". Sfrutta il motore di matching che c'è già, girato al contrario. Ottima retention.

### D4. Onboarding con preferenze
Raccogliere tratte/città preferite in onboarding per alimentare da subito il matching AI e i preferiti — oggi le `prefs` del profilo esistono ma non vengono popolate in modo guidato.

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
- **i18n ancora da fare**: altre schermate hardcoded (`CreateListingScreen` in parte, `EditProfileScreen`, alert sparsi in `MatchingScreen`/`OffersScreen`).
- ✅ **Bug funzionale scoperto e corretto**: in `components/OfferCTA.js` i pulsanti "Proponi acquisto"/"Proponi scambio" (usati sia in Home che nel dettaglio annuncio, stesso componente) avevano `onPress` che non facevano nulla oltre a un `console.log` — TODO mai completati. Ora navigano a `OfferFlow` con `{ mode: "buy"|"swap", listingId }`.
  Trovato un secondo bug collegato: `OfferFlow` confrontava `mode === "BUY"` (maiuscolo stretto), ma l'unico chiamante preesistente (`OfferDetailScreen`) passava `"buy"`/`"swap"` minuscolo — quindi il flusso mostrava **sempre** la UI di scambio, mai quella di acquisto, indipendentemente dal pulsante premuto. Reso il confronto case-insensitive, cosa che ripara anche `OfferDetailScreen` senza toccarlo.
- **Development build (EAS)**: necessaria per push, OAuth stabile e pubblicazione sugli store. È lo sblocco per D1/D2 e B2.
- **Migrazione graduale a TypeScript**: ridurrebbe i bug di forma dei dati (già oggi ci sono alias `asset_type`/`type`, `depart_at`/`start_date` gestiti a mano).
- **Rate limiter server su store condiviso** (Redis/Postgres) se si scala su più istanze.

---

## Ordine consigliato

1. **C1 Preferiti** (basso sforzo, valore immediato, tutto pronto lato DB)
2. **B1 Salvataggio PNR** (chiude un buco funzionale reale)
3. **Development build** → sblocca **B2 Google**, **D1 notifiche**
4. **C2 Galleria immagini** (qualità/fiducia)
5. **D1 Notifiche** → **D3 Avvisi di ricerca** → **D2 Chat**
