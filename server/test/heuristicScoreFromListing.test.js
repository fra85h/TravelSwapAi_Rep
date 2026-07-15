// Test per il fallback deterministico del matching quando è presente
// l'ANNUNCIO SORGENTE (user.fromListing) — il percorso reale in produzione.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicScore } from '../src/ai/score.js';

const fromTrain = {
  id: 'src',
  cerco_vendo: 'CERCO',
  type: 'train',
  route_from: 'Milano Centrale',
  route_to: 'Roma Termini',
  depart_at: '2026-09-10T08:00:00Z',
};

test('match perfetto: complementare + stesso tipo + stessa tratta ⇒ bidirezionale, score ≥ 90', () => {
  const [top] = heuristicScore({ fromListing: fromTrain }, [
    {
      id: 'a', cerco_vendo: 'VENDO', type: 'train',
      route_from: 'Milano Centrale', route_to: 'Roma Termini',
      depart_at: '2026-09-10T08:30:00Z',
    },
  ]);
  assert.ok(top.score >= 90);
  assert.equal(top.bidirectional, true);
  assert.equal(top.model, 'heuristic');
  assert.match(top.explanation, /VENDO complementare/);
});

test('stesso cerco_vendo (CERCO vs CERCO) non è mai bidirezionale', () => {
  const [only] = heuristicScore({ fromListing: fromTrain }, [
    {
      id: 'b', cerco_vendo: 'CERCO', type: 'train',
      route_from: 'Milano Centrale', route_to: 'Roma Termini',
      depart_at: '2026-09-10T09:00:00Z',
    },
  ]);
  assert.equal(only.bidirectional, false);
  assert.ok(only.score < 90);
});

test('tipo diverso dal sorgente: score massimo 30', () => {
  const [only] = heuristicScore({ fromListing: fromTrain }, [
    { id: 'c', cerco_vendo: 'VENDO', type: 'hotel', location: 'Roma' },
  ]);
  assert.ok(only.score <= 30);
  assert.equal(only.bidirectional, false);
});

test('tratta ricavata da location "A → B" quando mancano route_from/to', () => {
  const [top] = heuristicScore({ fromListing: fromTrain }, [
    {
      id: 'd', cerco_vendo: 'VENDO', type: 'train',
      location: 'Milano Centrale → Roma Termini',
      depart_at: '2026-09-10T10:00:00Z',
    },
  ]);
  assert.equal(top.bidirectional, true);
  assert.ok(top.score >= 90);
});

test('direzione inversa: piccolo bonus ma niente bidirezionale', () => {
  const [only] = heuristicScore({ fromListing: fromTrain }, [
    {
      id: 'e', cerco_vendo: 'VENDO', type: 'train',
      route_from: 'Roma Termini', route_to: 'Milano Centrale',
      depart_at: '2026-09-10T18:00:00Z',
    },
  ]);
  assert.equal(only.bidirectional, false);
  assert.ok(only.score < 90);
});

test('hotel: stessa località complementare ⇒ bidirezionale', () => {
  const fromHotel = {
    id: 'srcH', cerco_vendo: 'VENDO', type: 'hotel',
    location: 'Firenze', check_in: '2026-09-12',
  };
  const [top] = heuristicScore({ fromListing: fromHotel }, [
    { id: 'f', cerco_vendo: 'CERCO', type: 'hotel', location: 'Firenze', check_in: '2026-09-12' },
  ]);
  assert.equal(top.bidirectional, true);
  assert.ok(top.score >= 90);
});

test('ordina il match reciproco davanti ai candidati deboli', () => {
  const out = heuristicScore({ fromListing: fromTrain }, [
    { id: 'weak', cerco_vendo: 'CERCO', type: 'hotel', location: 'Bari' },
    {
      id: 'best', cerco_vendo: 'VENDO', type: 'train',
      route_from: 'Milano Centrale', route_to: 'Roma Termini',
      depart_at: '2026-09-10T08:00:00Z',
    },
    { id: 'mid', cerco_vendo: 'VENDO', type: 'train', route_from: 'Torino', route_to: 'Napoli' },
  ]);
  assert.deepEqual(out.map(r => r.id), ['best', 'mid', 'weak']);
});

test('normalizza accenti e maiuscole nel confronto tratte', () => {
  const [top] = heuristicScore(
    { fromListing: { ...fromTrain, route_from: 'FORLÌ', route_to: 'Roma' } },
    [{
      id: 'g', cerco_vendo: 'VENDO', type: 'train',
      route_from: 'forli', route_to: 'roma',
      depart_at: '2026-09-10T08:00:00Z',
    }]
  );
  assert.equal(top.bidirectional, true);
});
