# CLAUDE.md

Guida di orientamento per Claude Code (e altri assistenti AI) che lavorano su
questo repository. Per approfondire: `docs/FUNCTIONAL_OVERVIEW.md` (analisi
funzionale completa) e `docs/matching.md` (algoritmo di matching in dettaglio).

## Cos'è questo progetto

**TravelSwap**: marketplace peer-to-peer per rivendere o scambiare biglietti
treno e prenotazioni hotel non utilizzati. Monorepo con due progetti:

- **App** (`travelswap_ai/travelswapai/`): React Native + Expo, React
  Navigation, i18n custom **it/en/es** in `lib/i18n/translations.js`.
- **Backend** (`server/`): Node.js/Express — matching AI e TrustScore via
  OpenAI (`gpt-4o-mini`), webhook Facebook Messenger.
- **DB/Auth/Storage**: Supabase (Postgres + RLS). Migrations in
  `supabase/migrations/*.sql` — **nessun runner automatico** (vedi sotto).

## Comandi

| Cosa | Comando |
|---|---|
| Test backend | `cd server && node --experimental-test-module-mocks --test` (447 test, devono passare tutti; il flag serve a `mock.module()`, usato per i test che sostituiscono il client Supabase) |
| Test app RN/Expo | `cd travelswap_ai/travelswapai && npx jest` (119 test, Jest + jest-expo + Testing Library) |
| Test contro Postgres vero | vedi sotto: senza `DATABASE_URL` i 15 test in `server/test/db/` si saltano da soli |
| Schema ricostruibile da zero | `DATABASE_URL=... node server/tools/apply_migrations.mjs` (bootstrap + tutte le migration in ordine) |
| Il DB ha tutto ciò che il repo dichiara? | incolla `supabase/verify_schema.sql` nel SQL Editor: zero righe = allineato |
| Syntax check file server | `node --check <file>` |
| Parse-check file RN (JSX) | `node -e "require('@babel/parser').parse(require('fs').readFileSync('<file>','utf8'),{sourceType:'module',plugins:['jsx']})"` |
| Parità traduzioni it/en/es | vedi script sotto |
| Rebuild bundle web | `cd travelswap_ai/travelswapai && EXPO_OFFLINE=1 npx expo export --platform web --output-dir ../../server/public/app` |

Script parità i18n (le tre lingue devono avere lo stesso numero di chiavi):

```bash
cd travelswap_ai/travelswapai && node -e "
const t=require('./lib/i18n/translations.js');const T=t.default||t.translations||t;
function flat(o,p=''){let k=[];for(const key in o){const v=o[key];const np=p?p+'.'+key:key;if(v&&typeof v==='object'&&!Array.isArray(v))k=k.concat(flat(v,np));else k.push(np);}return k;}
const langs=Object.keys(T).filter(l=>T[l]&&typeof T[l]==='object');
const sets=langs.map(l=>new Set(flat(T[l])));
langs.forEach((l,i)=>console.log(l,sets[i].size));
"
```

Prima di aprire una PR: test verdi, parse OK su ogni file RN toccato, parità
i18n invariata, bundle web ricompilato e senza residui di mock/debug (grep sul
bundle finale per `debug-user` / `DEBUG_MOCK` deve dare 0).

Le regole che vivono nel database (trigger, vincoli, RLS) non le esegue
nessun mock: per provarle serve un Postgres vero. In CI lo fa il job
`test-db`; in locale:

```bash
createdb travelswap_test
export DATABASE_URL=postgres://localhost:5432/travelswap_test
node server/tools/apply_migrations.mjs   # bootstrap + 72 migration in ordine
cd server && npm test
```

Se aggiungi una migration, rigenera anche la verifica di allineamento
(`node supabase/tools/gen_verify_schema.mjs`): un test in CI fallisce se il
file committato non combacia più con le migration.

## Regole di modello (dominio)

- Un annuncio è **CERCO** (richiesta, nessun bene reale) o **VENDO**
  (biglietto/prenotazione reale). Colonna `listings.cerco_vendo`.
- **Un'offerta (acquisto O scambio) ha senso SOLO verso un VENDO.** Un CERCO
  non si compra né si riceve: è una richiesta, non un bene acquistabile.
- **Uno scambio richiede un biglietto su ENTRAMBI i lati**: sia il target sia
  l'annuncio offerto devono essere VENDO. Un CERCO non ha nulla da dare in
  cambio, quindi non può mai essere il lato "offerto" di uno scambio.
- **Scambio reale** (`listings.accepts_swap` + `swap_wanted`): un VENDO può
  dichiarare di accettare anche uno scambio e cosa cerca in cambio (tratta o
  località). Il matching abbina due VENDO che si incastrano e li marca
  reciproci quando ENTRAMBI vogliono ciò che l'altro offre.
- Queste regole sono applicate **sia lato client** (UI che nasconde le azioni
  non valide) **sia lato DB** (trigger `before_insert_offers_enforce` su
  `offers`): il backstop DB difende da qualsiasi client, non solo dall'app.
- **Matching** (dettagli in `docs/matching.md`): due livelli. Livello 1 = AI
  (`scoreWithAI`, solo strutturale: tipo/complementarità/tratta, MAI data o
  prezzo) con fallback deterministico (`heuristicScore`) se l'AI non
  risponde. Livello 2 = modificatore deterministico `adjustedScore` (budget +
  prossimità data, con tolleranza), applicato SEMPRE sopra il punteggio base.
  `matches.score` è `integer`: ogni punteggio derivato va arrotondato prima
  dell'insert.
- **TrustScore** (affidabilità %) è un concetto SEPARATO dal matching: media
  pesata di euristiche locali (45%) + analisi AI del testo (45%) + analisi AI
  delle foto (10%), con **tetti** per flag gravi (es. `IRRELEVANT_IMAGES` →
  max 55%). Il "perché" del punteggio deve essere SEMPRE visibile
  all'utente, specialmente quando è basso — non filtrare i flag per testo
  libero del messaggio (si rischia di nascondere un problema vero insieme al
  rumore, come successo con le foto non pertinenti).
- **Foto annuncio**: massimo 2 per annuncio, pertinenti al contenuto
  (biglietto per treno, stanza/prenotazione per hotel). Gestibili solo da
  "Modifica annuncio" (mai scorciatoie senza controllo). Cambiare le foto in
  modifica invalida il Check AI precedente: va rilanciato prima di salvare.
  Stessa cosa per i campi "critici" ai fini antifrode (prezzo, tratta,
  date/orari) — un'affidabilità calcolata sul prezzo vecchio non ha più
  senso su quello nuovo. Titolo/descrizione/altri campi secondari restano
  invece esclusi, per non intralciare piccole correzioni di testo.
  **Un ricontrollo fallito non deve mai cancellare un punteggio precedente
  valido**: regressione reale corretta in `20260731150000` — il trigger che
  propaga il punteggio da `trust_audit` sovrascriveva sempre `trust_score`
  anche quando la nuova verifica non produceva un punteggio (fallita/in
  sospeso), azzerando un'affidabilità buona già mostrata all'utente.
- **Ciclo di vita annuncio**: `active ⇄ paused` è reversibile; `deleted` è
  **terminale** (mai riattivabile — altrimenti equivarrebbe a "paused").
- **Scambio a catena (a 3)**: quando due utenti non si incastrano ma tre sì
  (A dà a B, B dà a C, C dà ad A), il matching li trova da solo e li propone
  in "Scambi a 3" — ricalcolo cron-only ogni 15 min
  (`POST /api/chains/recompute`, `server/src/models/chains.js`). Un utente
  con più annunci VENDO attivi partecipa comunque: ogni arco del grafo di
  desiderio sceglie l'annuncio specifico con punteggio migliore, non esclude
  l'utente. **Il costo cresce come CERCO × VENDO**, quindi due difese
  deterministiche prima di pagare il modello: si salta l'intero ricalcolo se
  nulla di rilevante è cambiato dall'ultimo giro (impronta sui campi che il
  grafo usa davvero — mai sul prezzo, che il decadimento automatico riscrive
  di continuo senza cambiare i cicli), e si scartano i candidati con data
  oltre `CHAIN_DATE_WINDOW_DAYS` (30) di distanza. Si filtra solo sulla
  **data**, mai sulla geografia: la vicinanza fra due città è il giudizio per
  cui l'AI esiste lì. Si chiude solo quando TUTTI E 3 confermano
  (`confirm_chain_participant`); da quel momento hanno una chat dedicata
  (`chain_messages`, RLS aperta solo a catena `completed` — mai prima, il
  giro può ancora decadere).
- **Valutazioni**: a transazione 1:1 conclusa, 1-5 stelle doppio cieco
  (`transaction_ratings`, RPC `rate_transaction`/`get_user_rating`): il
  proprio voto resta nascosto finché anche l'altra parte vota o passano 14
  giorni; sotto 3 voti rivelati si mostra "Nuovo", mai una media; voto
  immutabile. Gli scambi a 3 hanno la loro strada (`rate_chain_transaction`,
  `transaction_ratings.chain_id`): non passano da `offers`, quindi
  `rate_transaction` lì non si applica.
- **Domande a risposta chiusa pre-offerta**: catalogo treno/hotel
  (`lib/listingQuestions.mjs`) mostrato prima di proporre un'offerta, per
  ridurre lo scambio di contatti fuori app in chat.

## Migration: workflow manuale

**Non esiste un runner automatico.** Ogni file `supabase/migrations/*.sql` va
applicato **a mano** nel SQL Editor di Supabase, nell'ordine dei timestamp nel
nome file (`YYYYMMDDHHMMSS_descrizione.sql`).

- Quando una PR include una nuova migration, segnalalo **sempre** nel corpo
  della PR (sezione "⚠️ Azione manuale") e ricorda all'utente di eseguirla.
- Se l'utente chiede cosa manca da fare a mano, dagli il **contenuto SQL**
  pronto da incollare (non solo il path del file: non ha accesso diretto al
  repo) — idealmente con una query di verifica prima (es. su
  `information_schema.columns` o `pg_proc.prosrc`) così sa cosa manca senza
  doverlo chiedere di nuovo.
- **Trabocchetto enum**: confrontare una colonna enum con un letterale non
  presente nell'enum fallisce con `22P02` (es. `type = 'treno'` quando
  l'enum ha `'train'`). Fix: castare a testo, `col::text in (...)`. Stessa
  famiglia: chiamare `_norm(s text)` passandole una colonna enum
  (`offers.status`) senza `::text` fallisce con "function _norm(offer_status)
  does not exist" — non un errore silenzioso, ma blocca la query.
- **Prima di riscrivere una funzione/trigger esistente** (`CREATE OR REPLACE
  FUNCTION`): `grep` il nome su **tutti** i file in `supabase/migrations/*.sql`
  e usa come base la versione cronologicamente più recente (l'ultima per nome
  file), mai `init.sql` o una versione intermedia a memoria. Regola nata da una
  regressione reale: `before_insert_offers_enforce()` era stato corretto in
  `20260711160004` (cast `_norm(o.status::text)`), ma `20260717120000` l'ha
  riscritta ripartendo dalla versione vecchia per aggiungere il controllo
  VENDO/CERCO e ha perso il fix, rompendo *tutte* le proposte di scambio in
  produzione finché non è stato corretto di nuovo in `20260718120000`. Dopo
  ogni fix di questo tipo, fai anche un secondo giro: cerca lo stesso pattern
  di bug (`_norm(` senza `::text` su colonne enum, letterali fuori enum, ecc.)
  nelle altre funzioni collegate, non solo in quella segnalata.
- Le regole di business critiche (coerenza CERCO/VENDO, limite foto, ecc.)
  vanno sempre applicate anche via trigger DB, non solo lato client: è la
  difesa da qualunque client, non solo dall'app ufficiale.
- **Il database può divergere dal repo senza che nessuno se ne accorga**, ed
  è successo: sei migration consecutive del 30 luglio non erano mai state
  eseguite, quindi `release_all_stale_reservations`, i promemoria di conferma
  e valutazione, `resolve_exchange_dispute` e le valutazioni degli scambi a 3
  non esistevano in produzione — due cron fallivano a ogni giro senza che
  nulla lo segnalasse. `supabase/verify_schema.sql` (generato dalle
  migration) elenca ciò che manca: **zero righe = allineato**. Verifica la
  presenza degli oggetti, non il loro contenuto.
- **Recuperare una migration arretrata non è "incollarla e basta"**: se il
  database ha già dentro migration più recenti che riscrivono le stesse
  funzioni o gli stessi vincoli, riapplicare quella vecchia le riporta
  indietro. Successo davvero recuperando il 30 luglio: quelle migration
  rimettevano `notifications_type_check` a 12 valori (perdendo
  `listing_price_dropped` e `offer_expired`) e `notify_on_offer` alla
  versione senza il ramo `expired` — e siccome quella notifica nasce da un
  trigger `AFTER`, a fallire non sarebbe stato l'avviso ma l'operazione
  intera. Regola: dopo il recupero, riapplica in coda la versione **più
  recente** di ogni funzione/vincolo toccato.

## Workflow di sviluppo

- Commit in italiano, PR con corpo che spiega causa/fix/verifiche.
- Non pushare mai un bundle web con residui di mock/debug (verificare col
  grep prima del commit, vedi sezione Comandi).
- Se una decisione tocca semantica di modello (denaro, direzione di
  un'offerta, nuove colonne che cambiano il significato di un campo
  esistente), **chiedi prima** invece di assumere.

## Audit del codice: risparmio token

Durante gli **audit** (revisione di codice esistente alla ricerca di bug, non
durante lo sviluppo di una feature): analizza il codice **a blocchi** (un
file o un modulo alla volta, non tutto insieme), **non mostrare ragionamenti
estesi** nel testo visibile all'utente, e restituisci **solo riepiloghi
sintetici dei bug trovati** (file, riga, problema in una frase). L'obiettivo
è risparmiare token mantenendo la revisione utile.
