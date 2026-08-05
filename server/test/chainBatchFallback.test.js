// Ripiego per LOTTO nel punteggio delle catene a 3.
//
// Il punteggio si calcola a lotti da 40 candidati, in parallelo. Se un
// lotto non torna (timeout, 520, credito finito) si ricade sul punteggio
// deterministico — ma solo per QUEI candidati.
//
// Prima bastava un lotto andato storto per buttare via il lavoro di tutti
// gli altri: con 8 lotti e il terzo in timeout, i punteggi AI degli altri
// sette — già calcolati e già pagati — venivano scartati per rifare tutto
// con l'euristica. Si perdevano insieme i soldi spesi e la qualità dei
// lotti riusciti.
import test from 'node:test';
import assert from 'node:assert/strict';

import { heuristicChainScore } from '../src/ai/chainMatch.js';

const want = { id: 'w1', type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-09-10T09:00:00Z' };
const cand = (id, extra = {}) => ({
  id, type: 'train', route_from: 'Roma', route_to: 'Milano',
  depart_at: '2026-09-10T09:00:00Z', user_id: 'u-' + id, ...extra,
});

test('l\'euristica copre TUTTI i candidati che le vengono passati', () => {
  // È la proprietà su cui poggia il ripiego per lotto: dando all'euristica
  // solo i candidati del lotto fallito, quelli devono tornare tutti — se
  // ne perdesse qualcuno, sparirebbe dai risultati senza che nessuno lo
  // noti, ed è il difetto che stavamo evitando.
  const batch = [cand('a'), cand('b'), cand('c')];
  const out = heuristicChainScore(want, batch);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((x) => x.id).sort(), ['a', 'b', 'c']);
});

test('ogni punteggio dell\'euristica sta nella stessa scala 0-100 dell\'AI', () => {
  // I due punteggi finiscono nello stesso elenco e passano per la stessa
  // soglia: se le scale non coincidessero, un lotto su euristica sarebbe
  // sistematicamente avvantaggiato o penalizzato rispetto agli altri.
  const out = heuristicChainScore(want, [cand('a'), cand('b', { route_to: 'Torino' })]);
  for (const r of out) {
    assert.ok(Number.isInteger(r.score), `punteggio non intero: ${r.score}`);
    assert.ok(r.score >= 0 && r.score <= 100, `fuori scala: ${r.score}`);
  }
});

test('con un lotto vuoto non restituisce niente e non esplode', () => {
  assert.deepEqual(heuristicChainScore(want, []), []);
});

test('i risultati portano l\'id del candidato, non la sua posizione', () => {
  // I lotti vengono ricomposti in un elenco solo: se il ripiego
  // restituisse indici invece di id, i punteggi finirebbero sui candidati
  // sbagliati appena un lotto viene sostituito.
  const out = heuristicChainScore(want, [cand('zzz'), cand('aaa')]);
  assert.deepEqual(out.map((x) => x.id).sort(), ['aaa', 'zzz']);
});
