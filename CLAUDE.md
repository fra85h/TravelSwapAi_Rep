# CLAUDE.md

Guida di orientamento per Claude Code (e altri assistenti AI) che lavorano su
questo repository. Per approfondire: `docs/FUNCTIONAL_OVERVIEW.md` (analisi
funzionale completa) e `docs/matching.md` (algoritmo di matching in dettaglio).

## Cos'è questo progetto

**TravelSwapAI**: marketplace peer-to-peer per rivendere o scambiare biglietti
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
| Test backend | `cd server && node --test` (96 test, devono passare tutti) |
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
- **Ciclo di vita annuncio**: `active ⇄ paused` è reversibile; `deleted` è
  **terminale** (mai riattivabile — altrimenti equivarrebbe a "paused").

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
