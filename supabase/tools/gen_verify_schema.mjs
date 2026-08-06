// Genera supabase/verify_schema.sql: "il database ha davvero tutto quello
// che il repo dice di avere?"
//
// Perché serve. Le migration si applicano a mano, una per una, nel SQL
// Editor. Se una salta il giro non se ne accorge nessuno: il codice
// continua a girare finché un utente non tocca esattamente quella
// funzionalità. È successo davvero con chain_disputes — il pulsante
// "Segnala un problema" negli scambi a 3 falliva in produzione da giorni, e
// l'abbiamo scoperto per caso mentre cancellavamo dei dati di test.
//
// Perché GENERATA e non scritta a mano. Un elenco scritto a mano è
// aggiornato il giorno che lo scrivi e sbagliato la settimana dopo: è
// esattamente la stessa fragilità che dovrebbe togliere. Questo script
// legge le migration, quindi la verifica invecchia solo se invecchia il
// repo.
//
// COSA NON FA. Non confronta i CORPI: una funzione riscritta male,
// applicata a metà o rimasta a una versione vecchia risulta "presente".
// Trova gli oggetti MANCANTI, che è la classe di errore prodotta dal
// workflow manuale (una migration saltata), non quelli sbagliati.
//
// Uso:
//   node supabase/tools/gen_verify_schema.mjs [--out <file>]
//
// --out esiste per i test: possono generare in un file temporaneo e
// confrontarlo con quello committato, senza riscrivere il repo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
const argOut = process.argv.indexOf("--out");
const outFile = argOut !== -1 && process.argv[argOut + 1]
  ? path.resolve(process.argv[argOut + 1])
  : path.join(here, "..", "verify_schema.sql");

// Ordine cronologico = ordine di applicazione: un CREATE dopo un DROP
// vince, ed è il pattern idempotente usato ovunque qui
// (DROP ... IF EXISTS seguito da CREATE).
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

const tabelle = new Set();
const colonne = new Set(); // "tabella.colonna"
const funzioni = new Set();
const trigger = new Set();

// Le colonne dichiarate dentro il corpo di un CREATE TABLE: si prendono
// solo le righe che iniziano con un identificatore seguito da un tipo, e
// si scartano i vincoli (CONSTRAINT/PRIMARY KEY/...), che colonne non sono.
const PAROLE_NON_COLONNA = /^(constraint|primary|foreign|unique|check|exclude|like|inherits|partition)\b/i;

function colonneDelCorpo(corpoGrezzo) {
  // I commenti vanno via PRIMA di spezzare sulle virgole: una virgola
  // dentro un commento ("-- id, non l'uuid") taglia la definizione in due e
  // la seconda metà sembra una colonna nuova col nome della parola che
  // segue. È esattamente come sono nate le quattro colonne inesistenti
  // "listing_questions.lo", "payment_declarations.il" e compagnia.
  const corpo = corpoGrezzo.replace(/--[^\n]*/g, "");
  const out = [];
  let livello = 0;
  let riga = "";
  for (const ch of corpo) {
    if (ch === "(") livello++;
    if (ch === ")") livello--;
    if (ch === "," && livello === 0) {
      out.push(riga);
      riga = "";
      continue;
    }
    riga += ch;
  }
  out.push(riga);
  return out
    .map((r) => r.trim())
    .filter((r) => r && !PAROLE_NON_COLONNA.test(r))
    .map((r) => r.match(/^"?([a-z_][a-z0-9_]*)"?\s+\S/i)?.[1])
    .filter(Boolean);
}

/** Il corpo fra parentesi di un CREATE TABLE, bilanciando le annidate. */
function corpoDaIndice(sql, apertura) {
  let livello = 0;
  for (let i = apertura; i < sql.length; i++) {
    if (sql[i] === "(") livello++;
    else if (sql[i] === ")") {
      livello--;
      if (livello === 0) return sql.slice(apertura + 1, i);
    }
  }
  return "";
}

for (const f of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");

  // --- DROP prima di tutto il resto del file? No: in ordine di apparizione.
  // Si scorre il file una volta sola, riconoscendo ogni istruzione dove
  // capita, così l'ordine DROP -> CREATE dentro lo stesso file è rispettato.
  const istruzioni = [...sql.matchAll(
    /\b(create\s+table(?:\s+if\s+not\s+exists)?|drop\s+table(?:\s+if\s+exists)?|create(?:\s+or\s+replace)?\s+function|drop\s+function(?:\s+if\s+exists)?|create(?:\s+or\s+replace)?\s+trigger|drop\s+trigger(?:\s+if\s+exists)?|alter\s+table(?:\s+if\s+exists)?(?:\s+only)?)\s+([a-z0-9_."]+)/gi
  )];

  for (const m of istruzioni) {
    const verbo = m[1].toLowerCase().replace(/\s+/g, " ");
    const nomeGrezzo = m[2].replace(/"/g, "");
    const nome = nomeGrezzo.replace(/^public\./i, "").replace(/\($/, "");

    if (verbo.startsWith("create table")) {
      tabelle.add(nome);
      const apertura = sql.indexOf("(", m.index + m[0].length - 1);
      if (apertura !== -1) {
        for (const c of colonneDelCorpo(corpoDaIndice(sql, apertura))) colonne.add(`${nome}.${c}`);
      }
    } else if (verbo.startsWith("drop table")) {
      tabelle.delete(nome);
      for (const c of [...colonne]) if (c.startsWith(`${nome}.`)) colonne.delete(c);
    } else if (verbo.includes("function")) {
      // Il nome arriva attaccato alla parentesi degli argomenti.
      const pulito = nome.split("(")[0];
      if (verbo.startsWith("drop")) funzioni.delete(pulito);
      else funzioni.add(pulito);
    } else if (verbo.includes("trigger")) {
      if (verbo.startsWith("drop")) trigger.delete(nome);
      else trigger.add(nome);
    } else if (verbo.startsWith("alter table")) {
      // ADD COLUMN / DROP COLUMN dopo il nome della tabella, fino al ';'.
      const fine = sql.indexOf(";", m.index);
      const coda = sql.slice(m.index, fine === -1 ? undefined : fine);
      for (const add of coda.matchAll(/add\s+column(?:\s+if\s+not\s+exists)?\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
        colonne.add(`${nome}.${add[1]}`);
      }
      for (const del of coda.matchAll(/drop\s+column(?:\s+if\s+exists)?\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
        colonne.delete(`${nome}.${del[1]}`);
      }
    }
  }
}

// Gli oggetti di sistema/altri schemi non si verificano: qui interessa solo
// ciò che il repo crea in public.
for (const t of [...tabelle]) if (t.includes(".")) tabelle.delete(t);
for (const f of [...funzioni]) if (f.includes(".")) funzioni.delete(f);

const righe = [
  ...[...tabelle].sort().map((t) => `('tabella',  ${lit(t)})`),
  ...[...colonne].sort().map((c) => `('colonna',  ${lit(c)})`),
  ...[...funzioni].sort().map((f) => `('funzione', ${lit(f)})`),
  ...[...trigger].sort().map((g) => `('trigger',  ${lit(g)})`),
];

function lit(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

const sqlOut = `-- ============================================================
-- verify_schema.sql — GENERATO, non modificare a mano.
--   rigenera con: node supabase/tools/gen_verify_schema.mjs
--
-- Incolla tutto nel SQL Editor di Supabase ed esegui.
--
--   NESSUNA RIGA  = il database ha tutti gli oggetti che il repo dichiara.
--   QUALCHE RIGA  = quegli oggetti mancano, cioè una migration non è mai
--                   stata eseguita. La colonna "manca" dice cosa, e il
--                   nome di solito dice anche quale file cercare in
--                   supabase/migrations/.
--
-- Verifica la PRESENZA, non il contenuto: una funzione presente ma rimasta
-- a una versione vecchia non compare qui. Serve a intercettare la migration
-- saltata, che è l'errore che il workflow manuale produce davvero.
--
-- Le colonne di una tabella mancante non vengono elencate: si vedrebbe
-- l'intera tabella riga per riga, e la riga 'tabella' dice già tutto.
--
-- Oggetti attesi: ${tabelle.size} tabelle, ${colonne.size} colonne, ${funzioni.size} funzioni, ${trigger.size} trigger.
-- ============================================================

WITH attesi(tipo, oggetto) AS (VALUES
${righe.join(",\n")}
)
SELECT tipo, oggetto AS manca
FROM attesi a
WHERE NOT CASE a.tipo
  WHEN 'tabella' THEN to_regclass('public.' || a.oggetto) IS NOT NULL

  WHEN 'colonna' THEN
    -- assente = manca DAVVERO la colonna, non l'intera tabella
    to_regclass('public.' || split_part(a.oggetto, '.', 1)) IS NULL
    OR EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = split_part(a.oggetto, '.', 1)
        AND c.column_name = split_part(a.oggetto, '.', 2)
    )

  WHEN 'funzione' THEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = a.oggetto
  )

  WHEN 'trigger' THEN EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgname = a.oggetto
  )

  ELSE true
END
ORDER BY tipo, oggetto;
`;

fs.writeFileSync(outFile, sqlOut);
console.log(
  `verify_schema.sql generato da ${files.length} migration: ` +
  `${tabelle.size} tabelle, ${colonne.size} colonne, ${funzioni.size} funzioni, ${trigger.size} trigger.`
);
