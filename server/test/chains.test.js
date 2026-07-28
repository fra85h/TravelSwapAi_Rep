// Test per la ricerca cicli dello swap a catena (fase 2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findThreeCycles, buildDesireGraph } from '../src/models/chains.js';

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

// buildDesireGraph: v2 ammette proprietari con più annunci VENDO attivi
// (prima v1 li escludeva dal grafo). Nessuna chiave OPENAI_API_KEY in CI,
// quindi scoreChainCandidates ricade sempre sull'euristica deterministica.
test('un proprietario con più annunci VENDO partecipa comunque al grafo', async () => {
  const listings = [
    { id: 'a-cerco', user_id: 'A', cerco_vendo: 'CERCO', type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-08-01T09:00:00Z' },
    // A deve avere anche qualcosa da dare per essere idoneo alla catena (chi cerca e basta non può chiudere un ciclo)
    { id: 'a-vendo', user_id: 'A', cerco_vendo: 'VENDO', type: 'train', route_from: 'Torino', route_to: 'Genova', depart_at: '2026-08-05T09:00:00Z' },
    // B ha DUE annunci VENDO attivi: entrambi soddisfano il CERCO di A ma con punteggio diverso
    { id: 'b-match-alto', user_id: 'B', cerco_vendo: 'VENDO', type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-08-01T09:00:00Z' },
    { id: 'b-match-basso', user_id: 'B', cerco_vendo: 'VENDO', type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-08-20T09:00:00Z' },
    // e un terzo annuncio che NON soddisfa il CERCO di A (area e data lontane)
    { id: 'b-non-match', user_id: 'B', cerco_vendo: 'VENDO', type: 'train', route_from: 'Napoli', route_to: 'Bari', depart_at: '2026-09-20T09:00:00Z' },
  ];

  const { edges, bestEdgeListing, listingById } = await buildDesireGraph(listings);

  assert.ok(edges.get('A')?.has('B'), 'B deve comparire come candidato di A anche possedendo 2 annunci VENDO');
  assert.equal(
    bestEdgeListing.get('A|B').listingId,
    'b-match-alto',
    "va scelto l'annuncio col punteggio più alto tra quelli di B che soddisfano il CERCO di A"
  );
  // entrambi gli annunci di B restano risolvibili per id (serve a costruire
  // la proposta con l'annuncio giusto, non un altro annuncio dello stesso utente)
  assert.equal(listingById.get('b-match-alto').user_id, 'B');
  assert.equal(listingById.get('b-match-basso').user_id, 'B');
});
