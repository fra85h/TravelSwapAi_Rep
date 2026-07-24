// Test per la normalizzazione della spiegazione del punteggio testo
// (services/trust/aiTrust.js). Nasce da un caso reale: un annuncio al 95%
// mostrava solo «il punto più debole è "Analisi del testo (AI)" (90%)», un
// numero senza motivo né azione possibile. Ora il modello deve dire PERCHÉ,
// ma una spiegazione vuota di contenuto è peggio di nessuna spiegazione:
// occuperebbe lo spazio del "perché" fingendo di rispondere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTextReason } from '../src/services/trust/aiTrust.js';

test('una spiegazione concreta viene mantenuta', () => {
  const s = 'la descrizione non indica orario e classe del biglietto';
  assert.equal(cleanTextReason(s), s);
});

test('valori assenti o vuoti diventano null', () => {
  assert.equal(cleanTextReason(null), null);
  assert.equal(cleanTextReason(undefined), null);
  assert.equal(cleanTextReason(''), null);
  assert.equal(cleanTextReason('   '), null);
});

test('le frasi che non spiegano nulla vengono scartate', () => {
  assert.equal(cleanTextReason('va bene'), null);
  assert.equal(cleanTextReason('Nessun problema'), null);
  assert.equal(cleanTextReason('tutto ok'), null);
  assert.equal(cleanTextReason('Tutto a posto.'), null);
  assert.equal(cleanTextReason('niente da segnalare'), null);
  assert.equal(cleanTextReason('OK'), null);
});

test('le frasi vuote vengono scartate anche in inglese e spagnolo', () => {
  assert.equal(cleanTextReason('all good'), null);
  assert.equal(cleanTextReason('No issues'), null);
  assert.equal(cleanTextReason('sin problemas'), null);
});

test('una frase che INIZIA come generica ma spiega resta comunque scartata solo se lo è davvero', () => {
  // "coerente" da solo non spiega nulla...
  assert.equal(cleanTextReason('coerente'), null);
  // ...ma una frase che descrive un problema reale non deve essere persa
  // solo perché contiene una parola generica al suo interno.
  const s = 'il titolo non è coerente con la descrizione sulla data di partenza';
  assert.equal(cleanTextReason(s), s);
});

test('spazi e a capo multipli vengono compattati', () => {
  assert.equal(cleanTextReason('  descrizione   troppo\n\nbreve  '), 'descrizione troppo breve');
});

test('una spiegazione lunghissima viene troncata per restare leggibile', () => {
  const out = cleanTextReason('a'.repeat(400));
  assert.ok(out.length <= 240, `lunghezza ${out.length}`);
  assert.ok(out.endsWith('…'));
});

test('input non stringa non fa esplodere la funzione', () => {
  assert.equal(cleanTextReason(42), '42');
  assert.equal(cleanTextReason({}), '[object Object]');
});
