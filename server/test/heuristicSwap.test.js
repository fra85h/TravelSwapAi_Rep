// Test dello scambio reale tra due VENDO (Soluzione B): un VENDO che accetta
// scambio dichiara COSA cerca in cambio (swap_wanted); il matching abbina i
// due venditori che si incastrano e marca "reciproco" quando entrambi vogliono
// ciò che l'altro offre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicScore } from '../src/ai/score.js';

// Sorgente: HO Milano→Roma, e in cambio CERCO Roma→Milano.
const fromSwap = {
  id: 'src',
  cerco_vendo: 'VENDO',
  type: 'train',
  route_from: 'Milano Centrale',
  route_to: 'Roma Termini',
  depart_at: '2026-09-10T08:00:00Z',
  accepts_swap: true,
  swap_wanted: { type: 'train', from: 'Roma Termini', to: 'Milano Centrale' },
};

test('scambio reciproco: due VENDO che si incastrano ⇒ bidirezionale, score ≥ 90', () => {
  const [top] = heuristicScore({ fromListing: fromSwap }, [
    {
      id: 'a', cerco_vendo: 'VENDO', type: 'train',
      route_from: 'Roma Termini', route_to: 'Milano Centrale',
      depart_at: '2026-09-10T09:00:00Z',
      accepts_swap: true,
      swap_wanted: { type: 'train', from: 'Milano Centrale', to: 'Roma Termini' },
    },
  ]);
  assert.ok(top.score >= 90);
  assert.equal(top.bidirectional, true);
  assert.match(top.explanation, /reciproco/i);
});

test('scambio a senso unico: il candidato offre ciò che cerco, ma non ha dichiarato lo scambio ⇒ buono ma non reciproco', () => {
  const [top] = heuristicScore({ fromListing: fromSwap }, [
    {
      id: 'b', cerco_vendo: 'VENDO', type: 'train',
      route_from: 'Roma Termini', route_to: 'Milano Centrale',
      depart_at: '2026-09-10T09:00:00Z',
      accepts_swap: false,
    },
  ]);
  assert.equal(top.bidirectional, false);
  assert.ok(top.score >= 70 && top.score < 90);
  assert.match(top.explanation, /scambio/i);
});

test('nessuno scambio se la tratta cercata non combacia con ciò che il candidato offre', () => {
  const [only] = heuristicScore({ fromListing: fromSwap }, [
    {
      id: 'c', cerco_vendo: 'VENDO', type: 'train',
      route_from: 'Torino', route_to: 'Napoli',
      depart_at: '2026-09-10T09:00:00Z',
      accepts_swap: true,
      swap_wanted: { type: 'train', from: 'Napoli', to: 'Torino' },
    },
  ]);
  assert.equal(only.bidirectional, false);
  assert.ok(only.score < 70);
});

test('scambio senza swap_wanted esplicito: nessun falso positivo', () => {
  const from = { ...fromSwap, swap_wanted: null };
  const [only] = heuristicScore({ fromListing: from }, [
    {
      id: 'd', cerco_vendo: 'VENDO', type: 'train',
      route_from: 'Roma Termini', route_to: 'Milano Centrale',
      accepts_swap: true,
      swap_wanted: { type: 'train', from: 'Milano Centrale', to: 'Roma Termini' },
    },
  ]);
  // il sorgente non dichiara cosa vuole ⇒ non evoca scambio dal suo lato;
  // resta l'eventuale incastro a senso unico dal lato del candidato.
  assert.ok(only.score < 90);
});

test('scambio hotel: stessa località desiderata ⇒ reciproco', () => {
  const fromHotel = {
    id: 'srcH', cerco_vendo: 'VENDO', type: 'hotel', location: 'Firenze',
    check_in: '2026-09-12', accepts_swap: true,
    swap_wanted: { type: 'hotel', location: 'Bologna' },
  };
  const [top] = heuristicScore({ fromListing: fromHotel }, [
    {
      id: 'e', cerco_vendo: 'VENDO', type: 'hotel', location: 'Bologna',
      check_in: '2026-09-12', accepts_swap: true,
      swap_wanted: { type: 'hotel', location: 'Firenze' },
    },
  ]);
  assert.equal(top.bidirectional, true);
  assert.ok(top.score >= 90);
});
