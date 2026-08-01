// Ricerca in linguaggio naturale (server/src/ai/searchParse.js): qui si
// testa sanitizeFilters, cioè il pezzo deterministico che ripulisce quello
// che il modello restituisce. Il modello stesso non è testabile in CI (niente
// rete), ma è proprio per questo che ogni suo output passa da qui prima di
// diventare un filtro: se il modello sbaglia forma, l'utente non deve
// ritrovarsi zero risultati senza motivo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilters } from '../src/ai/searchParse.js';

test('sanitizeFilters: input vuoto -> tutti i filtri null (nessuna restrizione)', () => {
  const f = sanitizeFilters({});
  assert.deepEqual(f, {
    type: null, origin: null, destination: null, location: null,
    dateFrom: null, dateTo: null, maxPrice: null, minPrice: null,
  });
});

test('sanitizeFilters: tiene solo i tipi validi', () => {
  assert.equal(sanitizeFilters({ type: 'train' }).type, 'train');
  assert.equal(sanitizeFilters({ type: 'hotel' }).type, 'hotel');
  assert.equal(sanitizeFilters({ type: 'flight' }).type, null);
  assert.equal(sanitizeFilters({ type: 'TRENO' }).type, null);
});

test('sanitizeFilters: scarta le date non in formato YYYY-MM-DD', () => {
  assert.equal(sanitizeFilters({ dateFrom: '2026-08-08' }).dateFrom, '2026-08-08');
  assert.equal(sanitizeFilters({ dateFrom: '08/08/2026' }).dateFrom, null);
  assert.equal(sanitizeFilters({ dateFrom: 'venerdì' }).dateFrom, null);
});

test('sanitizeFilters: raddrizza un intervallo di date invertito', () => {
  // Un modello che inverte gli estremi produrrebbe altrimenti un intervallo
  // vuoto: zero risultati senza che l'utente possa capire perché.
  const f = sanitizeFilters({ dateFrom: '2026-08-20', dateTo: '2026-08-10' });
  assert.equal(f.dateFrom, '2026-08-10');
  assert.equal(f.dateTo, '2026-08-20');
});

test('sanitizeFilters: raddrizza min/max prezzo invertiti e scarta i negativi', () => {
  const f = sanitizeFilters({ minPrice: 80, maxPrice: 40 });
  assert.equal(f.minPrice, 40);
  assert.equal(f.maxPrice, 80);
  assert.equal(sanitizeFilters({ maxPrice: -5 }).maxPrice, null);
  assert.equal(sanitizeFilters({ maxPrice: 'quaranta' }).maxPrice, null);
});

test('sanitizeFilters: su un hotel la tratta viene azzerata', () => {
  // origin/destination su un hotel filtrerebbero via tutto: gli hotel non
  // hanno route_from/route_to.
  const f = sanitizeFilters({ type: 'hotel', origin: 'Roma', destination: 'Milano', location: 'Firenze' });
  assert.equal(f.origin, null);
  assert.equal(f.destination, null);
  assert.equal(f.location, 'Firenze');
});

test('sanitizeFilters: stringhe vuote o di soli spazi diventano null', () => {
  const f = sanitizeFilters({ origin: '   ', destination: '', location: 'Roma' });
  assert.equal(f.origin, null);
  assert.equal(f.destination, null);
  assert.equal(f.location, 'Roma');
});

test('sanitizeFilters: ignora chiavi fuori schema', () => {
  const f = sanitizeFilters({ origin: 'Roma', sqlInjection: "'; drop table listings;--" });
  assert.equal(f.sqlInjection, undefined);
  assert.equal(f.origin, 'Roma');
});
