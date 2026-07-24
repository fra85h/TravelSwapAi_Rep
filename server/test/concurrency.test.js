// Test per mapWithConcurrency (lib/concurrency.js), usata per parallelizzare
// i batch OpenAI in ai/score.js e ai/chainMatch.js. Le due proprietà che
// contano lì sono: l'ORDINE dei risultati resta quello degli input (altrimenti
// i punteggi finirebbero sugli annunci sbagliati) e il tetto di parallelismo
// viene rispettato (altrimenti si finisce nei rate limit di OpenAI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../src/lib/concurrency.js';

const tick = () => new Promise((r) => setTimeout(r, 1));

test('preserva l\'ordine degli input anche se i task finiscono fuori ordine', async () => {
  const items = [30, 1, 20, 2, 10];
  const out = await mapWithConcurrency(items, 3, async (n) => {
    await new Promise((r) => setTimeout(r, n));
    return n * 2;
  });
  assert.deepEqual(out, [60, 2, 40, 4, 20]);
});

test('non supera mai il tetto di parallelismo', async () => {
  let inFlight = 0;
  let peak = 0;
  await mapWithConcurrency([...Array(10).keys()], 3, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight--;
  });
  assert.ok(peak <= 3, `peak ${peak} > 3`);
});

test('esegue davvero in parallelo (peak > 1 quando ci sono più item)', async () => {
  let inFlight = 0;
  let peak = 0;
  await mapWithConcurrency([1, 2, 3, 4], 4, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight--;
  });
  assert.ok(peak > 1, 'nessun parallelismo osservato');
});

test('propaga gli errori (i chiamanti devono poter ricadere sull\'euristica)', async () => {
  await assert.rejects(
    () => mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('batch fallito');
      return n;
    }),
    /batch fallito/
  );
});

test('lista vuota o non valida ritorna array vuoto senza esplodere', async () => {
  assert.deepEqual(await mapWithConcurrency([], 3, async () => 1), []);
  assert.deepEqual(await mapWithConcurrency(null, 3, async () => 1), []);
  assert.deepEqual(await mapWithConcurrency(undefined, 3, async () => 1), []);
});

test('limite non valido o maggiore della lista non rompe l\'esecuzione', async () => {
  assert.deepEqual(await mapWithConcurrency([1, 2], 0, async (n) => n), [1, 2]);
  assert.deepEqual(await mapWithConcurrency([1, 2], 99, async (n) => n), [1, 2]);
  assert.deepEqual(await mapWithConcurrency([1, 2], NaN, async (n) => n), [1, 2]);
});
