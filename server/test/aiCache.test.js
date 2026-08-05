// Cache delle risposte AI.
//
// Serve a non pagare due volte la stessa domanda, ma la proprietà da
// difendere è l'opposto: non deve MAI restituire la risposta di una domanda
// diversa. Su una stima prezzo un falso positivo di cache significherebbe
// mostrare il valore di un'altra tratta come se fosse quello giusto.
import test from 'node:test';
import assert from 'node:assert/strict';

import { cacheKey, getCached, setCached, clearCache, cacheSize } from '../src/lib/aiCache.js';

test('quello che si scrive si rilegge', () => {
  clearCache();
  const k = cacheKey('a', 'b');
  setCached(k, { suggestedPrice: 42 });
  assert.deepEqual(getCached(k), { suggestedPrice: 42 });
});

test('una chiave mai vista non restituisce niente', () => {
  clearCache();
  assert.equal(getCached(cacheKey('mai', 'vista')), undefined);
});

test('input diversi danno chiavi diverse', () => {
  assert.notEqual(cacheKey('Roma', 'Milano'), cacheKey('Milano', 'Roma'));
  assert.notEqual(cacheKey('prompt', 'gpt-4.1'), cacheKey('prompt', 'gpt-4o-mini'));
});

test('pezzi concatenati diversamente non collidono', () => {
  // Senza separatore ("ab","c") e ("a","bc") darebbero la stessa chiave, e
  // due prompt diversi finirebbero sulla stessa risposta.
  assert.notEqual(cacheKey('ab', 'c'), cacheKey('a', 'bc'));
});

test('input uguali danno la stessa chiave, anche a distanza', () => {
  assert.equal(cacheKey('x', { a: 1 }), cacheKey('x', { a: 1 }));
});

test('una voce scaduta non viene servita', () => {
  clearCache();
  const k = cacheKey('scaduta');
  setCached(k, 'vecchia', -1); // già scaduta al momento della scrittura
  assert.equal(getCached(k), undefined);
});

test('la cache non cresce all\'infinito', () => {
  clearCache();
  for (let i = 0; i < 600; i++) setCached(cacheKey('voce', i), i);
  assert.ok(cacheSize() <= 500, `dimensione fuori controllo: ${cacheSize()}`);
});

test('sotto pressione esce la voce meno usata di recente, non una a caso', () => {
  clearCache();
  const primo = cacheKey('primo');
  setCached(primo, 'tengo');
  for (let i = 0; i < 400; i++) setCached(cacheKey('riempio', i), i);
  // Rileggerlo lo rimette in fondo alla coda di sfratto...
  assert.equal(getCached(primo), 'tengo');
  // ...e da lì sopravvive a un altro giro di riempimento.
  for (let i = 400; i < 600; i++) setCached(cacheKey('riempio', i), i);
  assert.equal(getCached(primo), 'tengo');
});

test('setCached restituisce il valore, così si può usare in un return', () => {
  clearCache();
  assert.deepEqual(setCached(cacheKey('r'), { ok: true }), { ok: true });
});
