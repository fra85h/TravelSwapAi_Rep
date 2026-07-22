// Test per il matching degli avvisi di ricerca (D3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch } from '../src/models/savedSearches.js';

const trainSearch = {
  type: 'train',
  cerco_vendo: 'VENDO',
  route_from: 'Roma',
  route_to: 'Milano',
  max_price: 40,
};

test('annuncio identico (tratta e prezzo) fa match', () => {
  const listing = { type: 'train', cerco_vendo: 'VENDO', status: 'active', route_from: 'Roma', route_to: 'Milano', price: 35 };
  assert.equal(matchesSearch(trainSearch, listing), true);
});

test('prezzo sopra il massimo NON fa match', () => {
  const listing = { type: 'train', cerco_vendo: 'VENDO', status: 'active', route_from: 'Roma', route_to: 'Milano', price: 55 };
  assert.equal(matchesSearch(trainSearch, listing), false);
});

test('prezzo uguale al massimo fa match (limite incluso)', () => {
  const listing = { type: 'train', cerco_vendo: 'VENDO', status: 'active', route_from: 'Roma', route_to: 'Milano', price: 40 };
  assert.equal(matchesSearch(trainSearch, listing), true);
});

test('tipo diverso NON fa match', () => {
  const listing = { type: 'hotel', cerco_vendo: 'VENDO', status: 'active', location: 'Roma', price: 35 };
  assert.equal(matchesSearch(trainSearch, listing), false);
});

test('tratta diversa NON fa match', () => {
  const listing = { type: 'train', cerco_vendo: 'VENDO', status: 'active', route_from: 'Napoli', route_to: 'Bari', price: 20 };
  assert.equal(matchesSearch(trainSearch, listing), false);
});

test('annuncio non attivo NON fa match anche se combacia in tutto', () => {
  const listing = { type: 'train', cerco_vendo: 'VENDO', status: 'sold', route_from: 'Roma', route_to: 'Milano', price: 35 };
  assert.equal(matchesSearch(trainSearch, listing), false);
});

test('cerco_vendo diverso NON fa match (di default un avviso cerca VENDO)', () => {
  const listing = { type: 'train', cerco_vendo: 'CERCO', status: 'active', route_from: 'Roma', route_to: 'Milano', price: 35 };
  assert.equal(matchesSearch(trainSearch, listing), false);
});

test('tollera varianti dello stesso nome città (stazioni diverse)', () => {
  const listing = { type: 'train', cerco_vendo: 'VENDO', status: 'active', route_from: 'Roma Termini', route_to: 'Milano Centrale', price: 35 };
  assert.equal(matchesSearch(trainSearch, listing), true);
});

test('formato "Città — Stazione" (autocompletamento): stazioni diverse della stessa città fanno match', () => {
  const search = { ...trainSearch, route_from: 'Roma — Termini', route_to: 'Milano — Garibaldi' };
  const listing = { type: 'train', cerco_vendo: 'VENDO', status: 'active', route_from: 'Roma — Tiburtina', route_to: 'Milano — Centrale', price: 35 };
  assert.equal(matchesSearch(search, listing), true);
});

test('senza prezzo massimo, qualsiasi prezzo va bene', () => {
  const search = { ...trainSearch, max_price: null };
  const listing = { type: 'train', cerco_vendo: 'VENDO', status: 'active', route_from: 'Roma', route_to: 'Milano', price: 500 };
  assert.equal(matchesSearch(search, listing), true);
});

test('hotel: confronta la città in location', () => {
  const hotelSearch = { type: 'hotel', cerco_vendo: 'VENDO', location: 'Firenze', max_price: 100 };
  assert.equal(matchesSearch(hotelSearch, { type: 'hotel', cerco_vendo: 'VENDO', status: 'active', location: 'Firenze centro', price: 80 }), true);
  assert.equal(matchesSearch(hotelSearch, { type: 'hotel', cerco_vendo: 'VENDO', status: 'active', location: 'Bari', price: 80 }), false);
});

test('input mancante non esplode', () => {
  assert.equal(matchesSearch(null, { type: 'train' }), false);
  assert.equal(matchesSearch(trainSearch, null), false);
  assert.equal(matchesSearch(null, null), false);
});
