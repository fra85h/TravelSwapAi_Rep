// Il modello risponde per INDICE, non per uuid.
//
// Perché: un uuid sono ~20 token, e il modello lo deve riscrivere per ogni
// candidato solo per dire a chi si riferisce il punteggio. Con 40 candidati
// per chiamata sono ~800 token di sola targhetta, in USCITA — dove costano
// quattro volte l'ingresso. Sul conto OpenAI l'uscita era la voce più cara
// di tutte ($5.04 contro $4.16 di ingresso).
//
// Ma un indice è anche un modo NUOVO di sbagliare: un uuid inventato non
// stava nell'elenco e cadeva da solo, mentre un indice sbagliato punta
// comunque a una riga esistente — quella di qualcun altro. Attribuire il
// punteggio di un annuncio a un altro creerebbe catene fra persone che non
// si incastrano, e sarebbe invisibile. Questi test stanno tutti lì.
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateChainScores } from '../src/ai/chainMatch.js';

const batch = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', type: 'train' },
  { id: 'bbbbbbbb-0000-0000-0000-000000000002', type: 'train' },
  { id: 'cccccccc-0000-0000-0000-000000000003', type: 'train' },
];

test('l\'indice torna all\'id giusto, nell\'ordine del prompt', () => {
  const out = validateChainScores([{ i: 2, score: 80 }, { i: 0, score: 40 }], batch);
  assert.deepEqual(out.map((x) => [x.id, x.score]), [
    [batch[2].id, 80],
    [batch[0].id, 40],
  ]);
});

test('un indice fuori dal lotto viene scartato, non attribuito a caso', () => {
  // È il caso pericoloso: 7 su un lotto da 3 non deve diventare
  // "l'ultimo" o "il primo" per comodità.
  const out = validateChainScores([{ i: 7, score: 99 }, { i: -1, score: 99 }, { i: 1, score: 70 }], batch);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, batch[1].id);
});

test('un indice ripetuto conta una volta sola', () => {
  // Due punteggi diversi per lo stesso candidato: si tiene il primo e si
  // ignora il secondo, invece di far vincere l'ultimo arrivato.
  const out = validateChainScores([{ i: 1, score: 90 }, { i: 1, score: 10 }], batch);
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 90);
});

test('un indice vuoto NON diventa il primo candidato', () => {
  // Number(null) è 0: senza il controllo esplicito, un campo vuoto
  // assegnerebbe quel punteggio al primo annuncio del lotto — uno a caso,
  // e in silenzio.
  const out = validateChainScores(
    [{ i: null, score: 90 }, { i: undefined, score: 90 }, { i: '', score: 90 }, { i: 1.5, score: 90 }],
    batch,
  );
  assert.equal(out.length, 0);
});

test('una cifra scritta come stringa si accetta', () => {
  // Variazione innocua e non ambigua: scartarla butterebbe via una
  // risposta già pagata.
  const out = validateChainScores([{ i: '1', score: 90 }], batch);
  assert.deepEqual(out.map((x) => x.id), [batch[1].id]);
});

test('il punteggio resta dentro 0-100 e intero', () => {
  const out = validateChainScores([{ i: 0, score: 250 }, { i: 1, score: -5 }, { i: 2, score: 71.6 }], batch);
  assert.deepEqual(out.map((x) => x.score), [100, 0, 72]);
});

test('un punteggio non numerico vale 0, non fa cadere il candidato', () => {
  const out = validateChainScores([{ i: 0, score: 'ottimo' }], batch);
  assert.deepEqual(out.map((x) => [x.id, x.score]), [[batch[0].id, 0]]);
});

test('una risposta non-array resta null: è il segnale di "AI non pervenuta"', () => {
  // Serve a scoreChainCandidates per distinguere "nessun candidato valido"
  // da "chiamata fallita, usa l'euristica per QUESTO lotto".
  assert.equal(validateChainScores(null, batch), null);
  assert.equal(validateChainScores({ scores: [] }, batch), null);
  assert.deepEqual(validateChainScores([], batch), []);
});

test('un lotto vuoto non accetta nessun indice', () => {
  assert.deepEqual(validateChainScores([{ i: 0, score: 90 }], []), []);
});
