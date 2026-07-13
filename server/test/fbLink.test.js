// Test per il riconoscimento del formato del codice di collegamento
// Messenger<->account (D: import annunci via bot Messenger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeLinkCode } from '../src/models/fbLink.js';

test('un codice di 6 caratteri dall\'alfabeto valido viene riconosciuto', () => {
  assert.equal(looksLikeLinkCode('AB2K9M'), true);
});

test('minuscolo viene comunque riconosciuto (case-insensitive)', () => {
  assert.equal(looksLikeLinkCode('ab2k9m'), true);
});

test('spazi attorno al codice vengono tollerati', () => {
  assert.equal(looksLikeLinkCode('  AB2K9M  '), true);
});

test('lunghezza sbagliata NON viene riconosciuta', () => {
  assert.equal(looksLikeLinkCode('AB2K9'), false);
  assert.equal(looksLikeLinkCode('AB2K9MX'), false);
});

test('caratteri ambigui esclusi dall\'alfabeto (0/O/1/I/L) NON matchano', () => {
  assert.equal(looksLikeLinkCode('AB2K9O'), false); // O non nell'alfabeto
  assert.equal(looksLikeLinkCode('AB2K90'), false); // 0 non nell'alfabeto
  assert.equal(looksLikeLinkCode('AB2K9I'), false); // I non nell'alfabeto
});

test('un testo normale di un annuncio NON viene scambiato per un codice', () => {
  assert.equal(looksLikeLinkCode('Vendo biglietto Roma Milano 45 euro'), false);
});

test('input mancante non esplode', () => {
  assert.equal(looksLikeLinkCode(null), false);
  assert.equal(looksLikeLinkCode(undefined), false);
  assert.equal(looksLikeLinkCode(''), false);
});
