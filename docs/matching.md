# Algoritmo di matching — cosa decide l'AI, cosa è deterministico

> Riferimento vivo per l'algoritmo che calcola il **Match %** mostrato in
> Esplora ("Per te") e nella schermata Suggeriti. A differenza di
> `FUNCTIONAL_OVERVIEW.md` (un'istantanea di analisi del codice), questo
> file va aggiornato ogni volta che l'algoritmo cambia.

## Pipeline in breve

```
per ogni annuncio TUO (sorgente):
  candidati = annunci attivi di altri utenti
  1. punteggio base 0-100          →  AI (o euristica se l'AI non risponde)
  2. fattore budget+data 0..1      →  deterministico
  3. punteggio finale = round(base × fattore)
  4. salva in tabella `matches`, aggiorna lo snapshot
```

Il punteggio che l'utente vede ("Match 79%") è **`punteggio finale`**, non
il punteggio base: è sempre la combinazione dei due livelli.

## Livello 1 — AI: giudizio strutturale

File: `server/src/ai/score.js` → `scoreWithAI()` (prompt in `buildPrompt()`).

L'AI (GPT-4o-mini, JSON strutturato, `temperature: 0`) risponde a **una sola
domanda**: *"questo candidato è una controparte sensata per il mio
annuncio?"*. Valuta solo:

- **complementarità** CERCO ↔ VENDO (stesso `cerco_vendo` non è mai un match);
- **stesso tipo** (`train` vs `hotel`);
- **stessa tratta** (`route_from`→`route_to`) o **stessa località** (hotel).

Produce per ogni candidato: `score` (0–100), `bidirectional` (match
reciproco quasi perfetto, mostrato con 💫), `explanation` (frase breve in
italiano).

**Cosa l'AI NON valuta (esplicitamente vietato nel prompt):** data/ora e
prezzo/budget. Prima li valutava anche lei, e sovra-reagiva: uno scarto di
un giorno poteva far crollare il match a 0%. Ora quella parte è demandata
al livello 2, deterministico e testato.

**Fallback senza AI** (`heuristicScore()`): se la chiave OpenAI manca, la
chiamata va in timeout, o lo schema JSON non valida, si passa a un
punteggio euristico che replica la stessa logica strutturale (base 35,
+15 stesso tipo, +20 complementare, +20 stessa tratta/località, ≥90 se
tutte e tre) — nessun LLM coinvolto, stesso contratto di output.

## Livello 2 — Deterministico: budget e prossimità data

File: `server/src/ai/score.js` → `priceFit()`, `dateFit()`,
`budgetDateFactor()`, `adjustedScore()`.

Applicato **sopra** al punteggio del livello 1 (AI o euristico), come
fattore moltiplicativo 0..1:

### Budget (`priceFit`)
Per un annuncio **CERCO**, il campo `price` è interpretato come il
**budget massimo**. Confrontato con il `price` del VENDO abbinato:

- venduto **entro budget** → `1` (nessuna penalità);
- **oltre budget** → cala linearmente; a **+50%** oltre budget
  (`MATCH_BUDGET_TOLERANCE`, default `0.5`) → `0`.
- prezzo/cerco_vendo mancanti, o annunci con lo stesso `cerco_vendo`
  (non c'è una coppia compratore/venditore) → neutro, `1`.

### Prossimità data (`dateFit`)
Confronta `depart_at` (treno) / `check_in` (hotel) delle due sorgenti:

- entro **`MATCH_DATE_GRACE_DAYS`** giorni (default **1**) → `1`, tolleranza
  piena, nessuna penalità;
- oltre la grazia, calo **lineare** su una finestra di
  **`MATCH_DATE_WINDOW_DAYS`** giorni (default **14**) fino a `0`;
- data mancante su un lato → neutro, `1`.

### Combinazione (`budgetDateFactor`)
```
factor = 1 − PRICE_WEIGHT × (1 − priceFit) − DATE_WEIGHT × (1 − dateFit)
```
Pesi di default `0.25` ciascuno: **nel caso peggiore il fattore non scende
sotto 0.5** — il punteggio si dimezza, non si azzera mai. Un match
strutturale forte (tratta/tipo/complementarità) resta quindi sempre
rilevante anche se prezzo o data non sono perfetti.

### Arrotondamento (`adjustedScore`)
```
punteggio finale = round(punteggio_base × budgetDateFactor(f, l))
```
La colonna `matches.score` è `integer`: il risultato **deve** essere
arrotondato prima dell'insert, altrimenti Postgres rifiuta un valore
frazionario (es. `48.172`) con un 400.

### Parametri (env, tutti opzionali)

| Env var | Default | Effetto |
|---|---|---|
| `MATCH_DATE_GRACE_DAYS` | `1` | giorni di tolleranza piena prima che la data inizi a pesare |
| `MATCH_DATE_WINDOW_DAYS` | `14` | ampiezza del calo lineare dopo la grazia |
| `MATCH_BUDGET_TOLERANCE` | `0.5` | quanto oltre budget (in % del budget) azzera `priceFit` |
| `MATCH_PRICE_WEIGHT` | `0.25` | peso del budget nel fattore combinato |
| `MATCH_DATE_WEIGHT` | `0.25` | peso della data nel fattore combinato |

## Livello 3 — Orchestrazione (deterministico)

File: `server/src/models/matches.js` → `recomputeMatches(userId)`.

1. Prende le tue listing attive come **sorgenti** e gli annunci attivi
   altrui come **candidati** (fino a 500).
2. Per ogni sorgente, esegue in parallelo (pool di concorrenza
   configurabile, default 4) il livello 1 + livello 2 sopra.
3. Cancella i match precedenti delle sorgenti **solo dopo** che il
   ricalcolo ha prodotto righe (mai svuota la tabella su un fallimento).
4. Upsert in `matches` (chunk configurabile), poi rigenera lo snapshot
   aggregato (`match_snapshots`), saltando la scrittura se identico al
   precedente.

### Endpoint (`server/src/routes/match.js`)
- `GET /api/matches/snapshot` — legge l'ultimo snapshot salvato.
- `POST /api/matches/snapshot/recompute` — ricalcola lo snapshot dai match già presenti in tabella (nessuna chiamata AI).
- `POST /api/matches/ai/recompute` — pipeline completa: livello 1+2 → upsert → snapshot. È quello che gira alla pubblicazione di un annuncio e dal pulsante "Aggiorna suggerimenti".

## Cosa NON è matching (per evitare confusione)

Il **"Check AI" / TrustScore** (`POST /ai/trustscore`,
`server/src/services/trust/`) è un sistema separato: valuta la
**qualità/veridicità del singolo annuncio** (tratta plausibile, coerenza
testo/tipo, foto), non la compatibilità tra due annunci. Non condivide
codice con questa pipeline.

## Esempio end-to-end

CERCO: budget 60€, partenza 1 ago. Candidato VENDO a 50€, stesso giorno:
- livello 1 (AI): 90 (complementare, stessa tratta)
- `priceFit` = 1 (entro budget), `dateFit` = 1 (stesso giorno) → `factor = 1`
- **punteggio finale = 90**

Stesso candidato a 90€ e all'8 agosto (7 giorni dopo):
- livello 1 (AI): 90 (l'AI non guarda più prezzo/data)
- `priceFit` = 0 (50% oltre budget), `dateFit` ≈ 0.57 (6 giorni oltre la
  grazia di 1, su finestra 14) → `factor ≈ 1 − 0.25×1 − 0.25×0.43 ≈ 0.64`
- **punteggio finale ≈ 58**

## Storico dei cambi rilevanti

- **Fase 1** — il campo prezzo di un CERCO diventa "Budget massimo" in UI
  (nessuna migration: riusa la colonna `price`).
- **Fase 2** — introdotto il livello 2 (budget + data) come modificatore
  del punteggio base.
- **Hotfix** — arrotondamento a intero prima dell'insert (bug: colonna
  `integer`, il fattore produceva decimali).
- **Fix tolleranza date** — spostata la valutazione di data/prezzo fuori
  dal prompt AI (che sovra-penalizzava) e introdotta la finestra di
  grazia in `dateFit`, per non azzerare mai il match per pochi giorni di
  scarto.
