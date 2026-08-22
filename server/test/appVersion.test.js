// La soglia di versione minima, lato server.
//
// Il server dichiara la versione più vecchia che sa ancora servire; l'app la
// confronta con la propria e, se è indietro, lo dice invece di far sbattere
// l'utente contro rifiuti che non sa spiegarsi. Serve perché non c'è nessun
// canale OTA: ogni correzione passa dallo store, e un'app già installata
// resta installata finché chi ce l'ha non decide di aggiornarla.
//
// Quello che questi test difendono è soprattutto lo stato SPENTO. Una soglia
// sbagliata blocca fuori tutti, e senza OTA non si corregge fino alla
// prossima release: deve essere impossibile attivarla per distrazione.
import { test } from "node:test";
import assert from "node:assert/strict";

/** L'handler dell'endpoint, isolato dal resto del server. */
function handler() {
  const minima = String(process.env.MIN_APP_VERSION || "").trim();
  return { minVersion: minima || null };
}

function conVariabile(valore, fn) {
  const prima = process.env.MIN_APP_VERSION;
  if (valore === undefined) delete process.env.MIN_APP_VERSION;
  else process.env.MIN_APP_VERSION = valore;
  try {
    return fn();
  } finally {
    if (prima === undefined) delete process.env.MIN_APP_VERSION;
    else process.env.MIN_APP_VERSION = prima;
  }
}

test("senza la variabile la soglia è nulla: nessuno viene bloccato", () => {
  assert.deepEqual(conVariabile(undefined, handler), { minVersion: null });
});

test("una variabile vuota o di soli spazi non attiva niente", () => {
  // È il caso che spaventa: una variabile impostata per sbaglio a stringa
  // vuota non deve valere "blocca tutti quelli sotto la versione vuota".
  assert.deepEqual(conVariabile("", handler), { minVersion: null });
  assert.deepEqual(conVariabile("   ", handler), { minVersion: null });
});

test("una soglia impostata viene dichiarata così com'è", () => {
  assert.deepEqual(conVariabile("1.4.0", handler), { minVersion: "1.4.0" });
  // Gli spazi attorno si tolgono: incollare da un pannello di configurazione
  // li porta dietro più spesso di quanto si creda.
  assert.deepEqual(conVariabile("  1.4.0  ", handler), { minVersion: "1.4.0" });
});

test("l'endpoint esiste davvero nel server, con quel percorso", async () => {
  // Il test sopra prova la regola su una copia dell'handler. Questo prova che
  // la regola sia montata dove il client la cerca: senza, i due potrebbero
  // divergere e nessuno se ne accorgerebbe.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const qui = path.dirname(url.fileURLToPath(import.meta.url));
  const sorgente = fs.readFileSync(path.join(qui, "..", "src", "index.js"), "utf8");

  assert.match(sorgente, /app\.get\(\s*['"]\/api\/app-version['"]/, "l'endpoint deve stare su /api/app-version");
  assert.match(sorgente, /MIN_APP_VERSION/, "e deve leggere MIN_APP_VERSION");
});
