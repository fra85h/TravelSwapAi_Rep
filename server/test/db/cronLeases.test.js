// Il turno dei cron: uno solo lo prende, e nessun altro.
//
// L'atomicità sta tutta nell'ON CONFLICT ... WHERE di claim_cron_lease:
// Postgres blocca la riga in conflitto, valuta la condizione e aggiorna solo
// se il lease è scaduto. È una promessa che nessun mock può verificare —
// serve un Postgres vero, e serve provarla con DUE connessioni davvero
// contemporanee, non con due chiamate in fila.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { motivoSkip, apri, chiudi } from "./helpers.mjs";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

const prendi = async (c, nome, ttl = 600) => {
  const { rows } = await c.query("select public.claim_cron_lease($1, $2) as gettone", [nome, ttl]);
  return rows[0].gettone;
};

const restituisci = async (c, nome, gettone) => {
  const { rows } = await c.query("select public.release_cron_lease($1, $2) as fatto", [nome, gettone]);
  return rows[0].fatto;
};

test("il secondo che chiede non prende niente", opzioni, async () => {
  const c = await apri();
  try {
    const primo = await prendi(c, "prova");
    assert.ok(primo, "il primo deve prendere il turno");
    assert.equal(await prendi(c, "prova"), null, "il secondo deve restare a mani vuote");
  } finally {
    await chiudi(c);
  }
});

test("restituito il turno, il successivo lo prende", opzioni, async () => {
  const c = await apri();
  try {
    const primo = await prendi(c, "prova");
    assert.equal(await restituisci(c, "prova", primo), true);
    assert.ok(await prendi(c, "prova"), "turno libero: il giro dopo deve poter partire");
  } finally {
    await chiudi(c);
  }
});

test("un turno scaduto si può prendere: un processo morto non blocca il cron per sempre", opzioni, async () => {
  const c = await apri();
  try {
    // TTL di un secondo, poi lo si fa scadere spostando indietro la riga:
    // aspettare davvero renderebbe il test lento e ballerino.
    const primo = await prendi(c, "prova", 1);
    assert.ok(primo);
    assert.equal(await prendi(c, "prova"), null);

    await c.query("update public.cron_leases set expires_at = now() - interval '1 second' where name = 'prova'");
    const secondo = await prendi(c, "prova");
    assert.ok(secondo, "scaduto il TTL il turno deve tornare libero");
    assert.notEqual(secondo, primo, "e chi lo riprende ha un gettone nuovo");
  } finally {
    await chiudi(c);
  }
});

test("un gettone vecchio non libera il turno di chi lavora adesso", opzioni, async () => {
  const c = await apri();
  try {
    // È lo scenario che rimetterebbe in piedi la sovrapposizione: un giro
    // lento sfora il TTL, perde il turno, un altro parte, e il primo alla
    // fine "restituisce" — liberando il turno di chi sta lavorando.
    const vecchio = await prendi(c, "prova", 1);
    await c.query("update public.cron_leases set expires_at = now() - interval '1 second' where name = 'prova'");
    const nuovo = await prendi(c, "prova");

    assert.equal(await restituisci(c, "prova", vecchio), false, "il gettone vecchio non vale più");
    assert.equal(await prendi(c, "prova"), null, "e il turno è ancora di chi lavora");
    assert.equal(await restituisci(c, "prova", nuovo), true);
  } finally {
    await chiudi(c);
  }
});

test("job diversi hanno turni diversi", opzioni, async () => {
  const c = await apri();
  try {
    assert.ok(await prendi(c, "chains"));
    assert.ok(await prendi(c, "price-decay"), "le catene non devono bloccare il decadimento prezzo");
  } finally {
    await chiudi(c);
  }
});

test("due connessioni contemporanee: ne vince una sola", opzioni, async () => {
  // La prova che conta. Due client veri, due transazioni aperte insieme, la
  // stessa riga contesa. Se l'ON CONFLICT non serializzasse, qui uscirebbero
  // due gettoni — ed è esattamente il doppio giro che il lease deve impedire.
  if (motivoSkip) return;
  const a = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const b = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const nome = `gara_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await a.connect();
    await b.connect();
    const [ra, rb] = await Promise.all([
      a.query("select public.claim_cron_lease($1, 600) as gettone", [nome]),
      b.query("select public.claim_cron_lease($1, 600) as gettone", [nome]),
    ]);
    const gettoni = [ra.rows[0].gettone, rb.rows[0].gettone].filter(Boolean);
    assert.equal(gettoni.length, 1, `un solo vincitore, invece: ${JSON.stringify(gettoni)}`);
  } finally {
    // Questa non gira in una transazione annullata: la riga va tolta a mano.
    await a.query("delete from public.cron_leases where name = $1", [nome]).catch(() => {});
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
});
