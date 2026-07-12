// Test per il fallback deterministico della normalizzazione fuzzy (fase 2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicChainScore } from '../src/ai/chainMatch.js';

const want = {
  id: 'want-1',
  type: 'train',
  route_from: 'Roma',
  route_to: 'Milano',
  depart_at: '2026-08-01T09:00:00Z',
};

test('stessa area + date vicine: score alto, passa la soglia', () => {
  const [top] = heuristicChainScore(want, [
    { id: 'a', type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-08-02T09:00:00Z' },
  ]);
  assert.equal(top.score, 100); // 30 + 15 (data) + 55 (area)
});

test('stessa area ma date lontane: passa comunque la soglia (65)', () => {
  const [top] = heuristicChainScore(want, [
    { id: 'a', type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-09-15T09:00:00Z' },
  ]);
  assert.equal(top.score, 85); // 30 + 55 (area), niente bonus data
});

test('date vicine ma area diversa: NON passa la soglia (65)', () => {
  const [top] = heuristicChainScore(want, [
    { id: 'a', type: 'train', route_from: 'Palermo', route_to: 'Catania', depart_at: '2026-08-02T09:00:00Z' },
  ]);
  assert.equal(top.score, 35); // 20 + 15 (data), niente area
  assert.ok(top.score < 65);
});

test('stessa area larga ma città diverse E date lontane: NON passa la soglia (bug reale trovato con test di integrazione)', () => {
  // Napoli/Bari e Palermo/Catania sono nella stessa area "sud" ma sono
  // città diverse e a quasi un mese di distanza: non deve bastare la sola
  // area larga a considerarli compatibili.
  const wantSud = { id: 'want-sud', type: 'train', route_from: 'Napoli', route_to: 'Bari', depart_at: '2026-08-03T09:00:00Z' };
  const [top] = heuristicChainScore(wantSud, [
    { id: 'a', type: 'train', route_from: 'Palermo', route_to: 'Catania', depart_at: '2026-09-01T09:00:00Z' },
  ]);
  assert.equal(top.score, 60); // 20 + 40 (area larga), niente data né città esatta
  assert.ok(top.score < 65);
});

test('tipo diverso: score 0 a prescindere dal resto', () => {
  const [top] = heuristicChainScore(want, [
    { id: 'a', type: 'hotel', location: 'Roma', check_in: '2026-08-01' },
  ]);
  assert.equal(top.score, 0);
});

test('città nella stessa area ma non identiche (stazioni diverse) contano comunque, sotto la soglia massima', () => {
  const wantVariant = { ...want, route_from: 'Roma Termini', route_to: 'Milano Centrale' };
  const [top] = heuristicChainScore(wantVariant, [
    { id: 'a', type: 'train', route_from: 'Roma Tiburtina', route_to: 'Milano Rogoredo', depart_at: '2026-08-01T09:00:00Z' },
  ]);
  assert.equal(top.score, 75); // area larga + data vicina, ma non è la stessa stringa di città esatta
  assert.ok(top.score >= 65);
});

test('fallback sul parsing di location "CittaA-->CittaB" quando route_from/route_to mancano', () => {
  const wantLegacy = { id: 'want-2', type: 'train', location: 'Roma-->Milano', depart_at: '2026-08-01T09:00:00Z' };
  const [top] = heuristicChainScore(wantLegacy, [
    { id: 'a', type: 'train', location: 'Roma-->Milano', depart_at: '2026-08-01T09:00:00Z' },
  ]);
  assert.equal(top.score, 100);
});

test('hotel: confronta la città in location + check_in', () => {
  const wantHotel = { id: 'want-3', type: 'hotel', location: 'Firenze', check_in: '2026-08-01' };
  const [close, far] = heuristicChainScore(wantHotel, [
    { id: 'a', type: 'hotel', location: 'Firenze centro', check_in: '2026-08-03' },
    { id: 'b', type: 'hotel', location: 'Bari', check_in: '2026-08-01' },
  ]).sort((x, y) => x.id.localeCompare(y.id));
  assert.equal(close.score, 75); // stessa area (Firenze), date vicine, non stringa città esatta
  assert.equal(far.score, 35);   // area diversa, solo data vicina
});

test('ordina per score decrescente, tie-break per id', () => {
  const out = heuristicChainScore(want, [
    { id: 'z', type: 'train', route_from: 'Palermo', route_to: 'Catania', depart_at: '2026-08-01T09:00:00Z' },
    { id: 'a', type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-08-01T09:00:00Z' },
    { id: 'b', type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-08-01T09:00:00Z' },
  ]);
  assert.deepEqual(out.map((r) => r.id), ['a', 'b', 'z']);
});

test('input vuoto non esplode', () => {
  assert.deepEqual(heuristicChainScore(want, []), []);
  assert.deepEqual(heuristicChainScore(want, null), []);
});
