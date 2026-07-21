// Test per il fallback deterministico del matching
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicScore } from '../src/ai/score.js';

const user = { prefs: { types: ['train'], maxPrice: 60, location: 'milano' } };

test('base 60 + bonus tipo/prezzo/località', () => {
  const [top] = heuristicScore(user, [
    { id: 'a', type: 'train', price: 45, location: 'Milano Centrale' },
  ]);
  // peso località alzato a 15 (preferenze più incisive su Esplora)
  assert.equal(top.score, 100); // 60 + 15 + 10 + 15, clampato a 100
  assert.equal(top.bidirectional, true); // >= 80
  assert.equal(top.model, 'heuristic');
});

test('preferenze con più zone (locations[]): basta che una combaci', () => {
  const multi = { prefs: { types: ['train'], maxPrice: 60, locations: ['roma', 'napoli'] } };
  const [top] = heuristicScore(multi, [
    { id: 'a', type: 'train', price: 45, location: 'Napoli Centrale' },
  ]);
  assert.equal(top.score, 100); // 60 + 15 + 10 + 15
});

test('nessuna preferenza soddisfatta: resta il punteggio base', () => {
  const [only] = heuristicScore(user, [
    { id: 'b', type: 'hotel', price: 500, location: 'Palermo' },
  ]);
  assert.equal(only.score, 60);
  assert.equal(only.bidirectional, false);
});

test('ordina per score decrescente, tie-break per id', () => {
  const out = heuristicScore(user, [
    { id: 'z', type: 'hotel', price: 500, location: 'Palermo' },
    { id: 'a', type: 'train', price: 45, location: 'Milano' },
    { id: 'b', type: 'hotel', price: 500, location: 'Palermo' },
  ]);
  assert.deepEqual(out.map(r => r.id), ['a', 'b', 'z']);
});

test('input vuoto o assente non esplode', () => {
  assert.deepEqual(heuristicScore(user, []), []);
  assert.deepEqual(heuristicScore(user, null), []);
  assert.deepEqual(heuristicScore(null, [{ id: 'a', type: 'train', price: 10 }]).length, 1);
});
