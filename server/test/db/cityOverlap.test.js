// La stessa domanda, la stessa risposta, da tutte e due le parti.
//
// "Questo annuncio riguarda la città che segui?" è scritta due volte:
// cityMatches() in JavaScript decide chi riceve DAVVERO l'avviso di ricerca
// salvata; _city_overlap() in SQL alimenta il "N persone seguono questa
// tratta" mostrato a chi sta scegliendo il prezzo.
//
// Prima non dicevano la stessa cosa — la JS toglie gli accenti e confronta
// insiemi di parole, la SQL faceva un confronto per prefisso — quindi il
// numero mostrato contava persone diverse da quelle poi avvisate. Su un
// numero che fa abbassare il prezzo per davvero, è un dato inventato.
//
// Questo test non verifica una lista di risultati attesi: mette le due
// implementazioni una di fronte all'altra su un elenco di coppie e pretende
// che rispondano uguale. Così, se una delle due cambia, se ne accorge la CI
// invece di chi pubblica.
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoSkip, apri, chiudi } from "./helpers.mjs";
import { cityMatches } from "../../src/models/savedSearches.js";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

// Coppie (cercata, effettiva). Ci sono i casi normali, quelli che prima
// divergevano, e i bordi che di solito nessuno prova.
const COPPIE = [
  // identiche
  ["Roma", "Roma"],
  ["roma", "ROMA"],
  // città e sua stazione, nei due versi
  ["Roma", "Roma Termini"],
  ["Roma Termini", "Roma"],
  ["Milano", "Milano Centrale"],
  // ordine delle parole invertito — la SQL prima diceva no
  ["Milano Centrale", "Centrale Milano"],
  // accenti — la SQL prima diceva no
  ["Forli", "Forlì"],
  ["Forlì", "Forli"],
  ["Forlì Centrale", "Forli"],
  ["Reggio Emilia", "Reggio nell'Emilia"],
  // il taglio al primo " — ", che nell'app separa città e dettaglio
  ["Roma — Termini", "Roma"],
  ["Roma", "Roma — Termini"],
  ["Roma — Termini", "Roma — Tiburtina"],
  // posti diversi
  ["Roma", "Napoli"],
  ["Roma Termini", "Milano Centrale"],
  ["Torino", "Torino Porta Nuova"],
  ["Torino Porta Susa", "Torino Porta Nuova"],
  // vuoti e spazi: "non mi interessa da dove" da un lato, "non lo sappiamo"
  // dall'altro, e non sono la stessa cosa
  ["", "Roma"],
  ["   ", "Roma"],
  [null, "Roma"],
  ["Roma", ""],
  ["Roma", "   "],
  ["Roma", null],
  [null, null],
  // spaziatura irregolare
  ["  Roma   Termini ", "Roma Termini"],
  ["Roma\tTermini", "Roma Termini"],
];

test("le due implementazioni rispondono uguale su tutte le coppie", opzioni, async () => {
  const c = await apri();
  try {
    const divergenze = [];
    for (const [cercata, effettiva] of COPPIE) {
      const { rows } = await c.query("select public._city_overlap($1, $2) as sql", [cercata, effettiva]);
      const daSql = rows[0].sql;
      const daJs = cityMatches(cercata, effettiva);
      if (daSql !== daJs) divergenze.push({ cercata, effettiva, daSql, daJs });
    }
    assert.deepEqual(divergenze, [], "SQL e JS devono dare la stessa risposta");
  } finally {
    await chiudi(c);
  }
});

test("i casi che prima divergevano ora combaciano davvero", opzioni, async () => {
  const c = await apri();
  try {
    // Un test di sola coerenza passerebbe anche se entrambe dicessero
    // sempre "no". Qui si fissa il valore atteso sui casi che contano.
    const attesi = [
      ["Forli", "Forlì", true],
      ["Milano Centrale", "Centrale Milano", true],
      ["Roma", "Roma Termini", true],
      ["Roma — Termini", "Roma — Tiburtina", true],
      ["Roma", "Napoli", false],
      ["Torino Porta Susa", "Torino Porta Nuova", false],
    ];
    for (const [cercata, effettiva, atteso] of attesi) {
      const { rows } = await c.query("select public._city_overlap($1, $2) as v", [cercata, effettiva]);
      assert.equal(rows[0].v, atteso, `_city_overlap(${cercata}, ${effettiva})`);
      assert.equal(cityMatches(cercata, effettiva), atteso, `cityMatches(${cercata}, ${effettiva})`);
    }
  } finally {
    await chiudi(c);
  }
});

test("il campo vuoto di chi cerca vale tutto, quello dell'annuncio vale niente", opzioni, async () => {
  const c = await apri();
  try {
    // Asimmetria voluta: un avviso senza città vuol dire "non mi interessa da
    // dove". Un annuncio senza città invece non si sa dove sia, e indovinare
    // qui vorrebbe dire mandare un avviso sbagliato.
    const { rows } = await c.query(`
      select public._city_overlap(null, 'Roma') as cerca_vuoto,
             public._city_overlap('Roma', null) as annuncio_vuoto,
             public._city_overlap('  ', 'Roma')  as cerca_spazi`);
    assert.equal(rows[0].cerca_vuoto, true);
    assert.equal(rows[0].annuncio_vuoto, false);
    assert.equal(rows[0].cerca_spazi, true);
  } finally {
    await chiudi(c);
  }
});
