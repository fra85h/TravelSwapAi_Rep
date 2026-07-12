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

### C3. Storico transazioni — `transactions`
Tabella pronta ma nessuna UI. Serve: sezione "I miei scambi/acquisti" nel profilo. Utile per fiducia e ricomprensione dello stato.

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

Non ancora fatto (prossimi passi naturali): font custom (Sora/Plus Jakarta Sans — richiede installare `expo-font`, rimandato per non sommare un altro giro di installazione dopo quello di `expo-image-picker`), estensione dell'ombra morbida alle card rimanenti, unificazione delle 3 librerie di icone su una sola.

---

## E. Qualità del codice / infrastruttura

- **i18n incompleto**: molte stringhe sono hardcoded in italiano fuori dal dizionario (es. schermata login, alert). Completarle abilita davvero EN/ES.
- **Development build (EAS)**: necessaria per push, OAuth stabile e pubblicazione sugli store. È lo sblocco per D1/D2 e B2.
- **Migrazione graduale a TypeScript**: ridurrebbe i bug di forma dei dati (già oggi ci sono alias `asset_type`/`type`, `depart_at`/`start_date` gestiti a mano).
- **Riduzione `console.log`**: molti log di debug ancora presenti nelle schermate.
- **Rate limiter server su store condiviso** (Redis/Postgres) se si scala su più istanze.

---

## Ordine consigliato

1. **C1 Preferiti** (basso sforzo, valore immediato, tutto pronto lato DB)
2. **B1 Salvataggio PNR** (chiude un buco funzionale reale)
3. **Development build** → sblocca **B2 Google**, **D1 notifiche**
4. **C2 Galleria immagini** (qualità/fiducia)
5. **D1 Notifiche** → **D3 Avvisi di ricerca** → **D2 Chat**
