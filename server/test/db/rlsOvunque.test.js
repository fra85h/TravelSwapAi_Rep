// Nessuna tabella nostra senza Row-Level Security.
//
// La chiave anon sta dentro l'app di chiunque la installi. Una tabella in
// `public` con l'RLS spenta è quindi leggibile e scrivibile da fuori
// dall'indirizzo del progetto: non serve nessun attacco, basta conoscere
// l'URL. È il controllo che Supabase manda per mail come "Table publicly
// accessible" (rls_disabled_in_public), e arriva DOPO — a tabella già
// online, magari per giorni.
//
// Questo test lo anticipa: gira sullo schema ricostruito da tutte le
// migration, quindi una tabella nuova senza `ENABLE ROW LEVEL SECURITY`
// fallisce in CI, prima ancora di esistere in produzione.
//
// Cosa NON verifica, di proposito: che le policy ci siano. "RLS accesa e
// zero policy" è la chiusura più stretta che esista — nessuno passa tranne
// il service_role, che l'RLS la scavalca — ed è la scelta giusta per una
// dozzina di tabelle di servizio (trust_audit, listing_events, cron_leases,
// report_action_tokens…). Pretendere almeno una policy le romperebbe tutte.
// Quali policy servono è una decisione per tabella, non una regola.
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoSkip, apri, chiudi } from "./helpers.mjs";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

// Schemi gestiti da Supabase o da Postgres: non sono nostri e non si toccano.
const NON_NOSTRI = [
  "pg_catalog", "information_schema", "auth", "storage", "realtime", "vault",
  "extensions", "supabase_migrations", "net", "cron", "graphql", "graphql_public",
  "pgsodium", "pgsodium_masks", "_realtime", "supabase_functions",
];

test("ogni tabella dello schema ha la RLS accesa", opzioni, async () => {
  const c = await apri();
  try {
    // relkind copre anche partizionate ('p') ed esterne ('f'): guardare solo
    // le tabelle ordinarie ('r') lascerebbe scoperti proprio i casi che
    // nessuno pensa a controllare.
    const { rows: scoperte } = await c.query(
      `select n.nspname as schema, c.relname as tabella, c.relkind as tipo
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r','p','f')
          and not c.relrowsecurity
          and n.nspname <> all($1::text[])
          and n.nspname not like 'pg\\_temp%'
          and n.nspname not like 'pg\\_toast%'
        order by 1, 2`,
      [NON_NOSTRI],
    );

    assert.deepEqual(
      scoperte.map((r) => `${r.schema}.${r.tabella}`),
      [],
      "tabelle senza RLS: con la chiave anon sono leggibili e scrivibili da fuori.\n" +
      "Aggiungi ALTER TABLE ... ENABLE ROW LEVEL SECURITY nella migration che le crea,\n" +
      "e le policy che servono (zero policy = chiusa a tutti tranne il service_role).",
    );
  } finally {
    await chiudi(c);
  }
});

test("il controllo sta guardando davvero qualcosa", opzioni, async () => {
  const c = await apri();
  try {
    // Senza questo, il test sopra passerebbe anche se la query non trovasse
    // mai niente per un errore di filtro: un verde per assenza di dati, che
    // è il modo più silenzioso di non proteggere niente.
    const { rows } = await c.query(
      `select count(*)::int as n
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname = 'public' and c.relrowsecurity`,
    );
    assert.ok(rows[0].n > 20, `trovate solo ${rows[0].n} tabelle con RLS: la scansione non funziona`);
  } finally {
    await chiudi(c);
  }
});
