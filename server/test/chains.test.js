// Test per la ricerca cicli dello swap a catena (fase 2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findThreeCycles } from '../src/models/chains.js';

function graphFromPairs(pairs) {
  const edges = new Map();
  for (const [a, b] of pairs) {
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a).add(b);
  }
  return edges;
}

test('trova un ciclo chiuso di 3', () => {
  const edges = graphFromPairs([
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'A'],
  ]);
  const cycles = findThreeCycles(edges);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].slice().sort(), ['A', 'B', 'C']);
});

test('nessun ciclo se manca un arco di chiusura', () => {
  const edges = graphFromPairs([
    ['A', 'B'],
    ['B', 'C'],
    // manca C -> A
  ]);
  assert.deepEqual(findThreeCycles(edges), []);
});

test('un ciclo a 2 (reciproco diretto) non conta come ciclo a 3', () => {
  const edges = graphFromPairs([
    ['A', 'B'],
    ['B', 'A'],
  ]);
  assert.deepEqual(findThreeCycles(edges), []);
});

test('deduplica lo stesso ciclo trovato da punti di partenza diversi', () => {
  const edges = graphFromPairs([
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'A'],
  ]);
  // findThreeCycles itera su tutti i nodi come possibile punto di partenza:
  // A->B->C->A, B->C->A->B, C->A->B->C sono la stessa terna
  assert.equal(findThreeCycles(edges).length, 1);
});

test('trova più cicli distinti nello stesso grafo, ignora rumore senza chiusura', () => {
  const edges = graphFromPairs([
    ['A', 'B'], ['B', 'C'], ['C', 'A'], // ciclo 1
    ['X', 'Y'], ['Y', 'Z'], ['Z', 'X'], // ciclo 2
    ['P', 'Q'], ['Q', 'R'],             // nessuna chiusura
  ]);
  const cycles = findThreeCycles(edges).map((c) => c.slice().sort().join(','));
  assert.equal(cycles.length, 2);
  assert.ok(cycles.includes('A,B,C'));
  assert.ok(cycles.includes('X,Y,Z'));
});

test('grafo vuoto non esplode', () => {
  assert.deepEqual(findThreeCycles(new Map()), []);
});
