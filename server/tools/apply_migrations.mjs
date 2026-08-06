// Ricostruisce il database da zero: bootstrap Supabase + tutte le migration
// in ordine cronologico.
//
// A cosa serve. Le migration si applicano a mano, una alla volta, su un
// database che ha già dentro tutte le precedenti. Nessuno le ha mai
// riapplicate tutte insieme su un database vuoto — e finché non lo si fa,
// "il repo descrive il database" è una speranza, non un fatto. Un errore di
// ordine, una dipendenza mancante o un file che non riparte da zero non si
// vedono in nessun altro modo.
//
// È anche il primo passo per i test veri: senza uno schema ricostruibile
// non c'è niente contro cui provare le RPC.
//
// Sta in server/tools/ e non in supabase/tools/ per un motivo prosaico: gli
// serve il pacchetto `pg`, e Node risolve le dipendenze a partire dalla
// cartella del file. Il generatore di verify_schema.sql, che non ha
// dipendenze, resta invece accanto alle migration.
//
// Uso:
//   DATABASE_URL=postgres://... node server/tools/apply_migrations.mjs
//
// Ogni file gira nella SUA transazione: se fallisce, quel file non lascia
// pezzi a metà e il messaggio dice esattamente quale sia. Non un'unica
// transazione per tutto, altrimenti il primo errore cancella anche
// l'informazione su quanto si era arrivati.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const supabaseDir = path.join(here, "..", "..", "supabase");
const bootstrap = path.join(supabaseDir, "test", "bootstrap.sql");
const migrationsDir = path.join(supabaseDir, "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL non impostata.");
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });

async function esegui(file, etichetta) {
  const sql = fs.readFileSync(file, "utf8");
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    return null;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    // position è l'offset di carattere nel file: tradotto in numero di riga
    // è la differenza fra "qualcosa non va in questo file da 500 righe" e
    // il punto esatto.
    const riga = e.position ? sql.slice(0, Number(e.position)).split("\n").length : null;
    return `${etichetta}${riga ? ` (riga ~${riga})` : ""}: ${e.message}`;
  }
}

const errori = [];

await client.connect();

const errBootstrap = await esegui(bootstrap, "bootstrap.sql");
if (errBootstrap) {
  // Senza impalcatura non ha senso proseguire: fallirebbero tutte le
  // migration, per lo stesso motivo, seppellendo la causa vera.
  console.error(`✗ ${errBootstrap}`);
  await client.end();
  process.exit(1);
}
console.log("✓ bootstrap.sql");

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  const err = await esegui(path.join(migrationsDir, f), f);
  if (err) {
    errori.push(err);
    console.error(`✗ ${err}`);
  } else {
    console.log(`✓ ${f}`);
  }
}

await client.end();

console.log(`\n${files.length - errori.length}/${files.length} migration applicate.`);
if (errori.length) {
  console.error(`\n${errori.length} fallite:\n` + errori.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}
