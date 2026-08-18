// Un giro di manutenzione alla volta.
//
// I quattro endpoint periodici erano protetti solo da un rate limiter, che
// conta le richieste ma non sa niente di quelle ancora in corso. Un giro più
// lento del solito e il successivo che parte a orario si sovrappongono, e due
// esecuzioni fanno lo stesso lavoro due volte.
//
// Il turno vive nel database perché il server parla con Postgres via
// PostgREST: ogni chiamata è una sessione a sé, quindi pg_advisory_lock —
// che alla sessione è legato — si scioglierebbe prima ancora che il lavoro
// cominci. Un lease con scadenza sopravvive alla chiamata e si libera da solo
// se il processo muore a metà.
//
// Un solo mock.module per file: chiamarlo due volte sullo stesso specificatore
// solleva ERR_INVALID_STATE. Le risposte della rpc si cambiano quindi da una
// variabile, non rimontando il mock.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let risposte = {};
const chiamate = [];

mock.module("../src/db.js", {
  namedExports: {
    supabase: {
      rpc: async (nome, args) => {
        chiamate.push({ nome, args });
        const r = risposte[nome];
        return typeof r === "function" ? r(args) : (r ?? { data: null, error: null });
      },
    },
  },
});

const { withCronLease } = await import("../src/middleware/withCronLease.js");

function fakeRes() {
  const res = { statusCode: 200, body: null, ascoltatori: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.on = (evento, fn) => { (res.ascoltatori[evento] ||= []).push(fn); return res; };
  // Express emette 'finish' quando la risposta è partita: qui lo simuliamo
  // per verificare che il turno venga restituito a fine giro.
  res.emit = async (evento) => {
    for (const fn of res.ascoltatori[evento] || []) await fn();
  };
  return res;
}

function prepara(nuove) {
  risposte = nuove;
  chiamate.length = 0;
}

const prese = (nome) => chiamate.filter((c) => c.nome === nome);

test("chi non prende il turno salta il giro senza fare danni", async () => {
  // claim_cron_lease restituisce NULL: il turno è di qualcun altro.
  prepara({ claim_cron_lease: { data: null, error: null } });

  const res = fakeRes();
  let proseguito = false;
  await withCronLease("prova")({}, res, () => { proseguito = true; });

  assert.equal(proseguito, false, "il lavoro NON deve partire");
  // 200 e non un errore: il giro è saltato di proposito perché ce n'è già uno
  // in corso. Un 500 farebbe suonare gli allarmi per il funzionamento normale.
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { skipped: true, reason: "already_running" });
  assert.equal(prese("claim_cron_lease").length, 1);
  assert.equal(prese("release_cron_lease").length, 0, "non si restituisce un turno che non si ha");
});

test("chi prende il turno lavora e alla fine lo restituisce", async () => {
  prepara({
    claim_cron_lease: { data: "gettone-1", error: null },
    release_cron_lease: { data: true, error: null },
  });

  const res = fakeRes();
  let proseguito = false;
  await withCronLease("prova", { ttlSeconds: 42 })({}, res, () => { proseguito = true; });

  assert.equal(proseguito, true);
  assert.equal(chiamate[0].args.p_ttl_seconds, 42);
  // Il turno è ancora in mano: finché la risposta non è chiusa, il lavoro gira.
  assert.equal(prese("release_cron_lease").length, 0);

  await res.emit("finish");
  const restituzioni = prese("release_cron_lease");
  assert.equal(restituzioni.length, 1);
  // Il gettone va riconsegnato: senza, un giro che ha sforato il TTL
  // libererebbe il turno di chi sta lavorando adesso.
  assert.equal(restituzioni[0].args.p_holder, "gettone-1");
});

test("il turno si restituisce una volta sola", async () => {
  // 'finish' e 'close' possono scattare entrambi sulla stessa risposta.
  prepara({
    claim_cron_lease: { data: "gettone-1", error: null },
    release_cron_lease: { data: true, error: null },
  });

  const res = fakeRes();
  await withCronLease("prova")({}, res, () => {});
  await res.emit("finish");
  await res.emit("close");

  assert.equal(prese("release_cron_lease").length, 1);
});

test("se il turno non si può chiedere, la manutenzione gira lo stesso", async () => {
  // Saltare ogni giro perché la tabella dei turni non risponde trasformerebbe
  // un guasto piccolo in "la manutenzione non gira più", che è peggio del
  // rischio che questo middleware evita.
  prepara({ claim_cron_lease: { data: null, error: { message: "boom" } } });

  const res = fakeRes();
  let proseguito = false;
  await withCronLease("prova")({}, res, () => { proseguito = true; });

  assert.equal(proseguito, true);
  assert.equal(res.body, null, "nessuna risposta anticipata: decide l'handler");
});

test("ogni job ha il suo turno, non se lo tolgono a vicenda", async () => {
  // Il nome è la chiave: le catene e il decadimento prezzo devono poter
  // girare insieme, sono lavori diversi su dati diversi.
  prepara({
    claim_cron_lease: ({ p_name }) => ({ data: `gettone-${p_name}`, error: null }),
    release_cron_lease: { data: true, error: null },
  });

  const a = fakeRes();
  const b = fakeRes();
  let partiti = 0;
  await withCronLease("chains")({}, a, () => { partiti++; });
  await withCronLease("price-decay")({}, b, () => { partiti++; });

  assert.equal(partiti, 2);
  assert.deepEqual(prese("claim_cron_lease").map((c) => c.args.p_name), ["chains", "price-decay"]);
});
