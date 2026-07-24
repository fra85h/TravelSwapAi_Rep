// Test per la ponderazione del TrustScore (services/trust/computeTrustScore.js).
// Copre la regressione: un annuncio SENZA foto veniva penalizzato dalla
// componente "analisi delle foto", perché l'AI — senza immagini da guardare —
// restituiva imageScore 0 e quello zero entrava nella media pesata. Un
// annuncio all'86% mostrava come punto più debole "Analisi delle foto (0%)":
// un difetto inesistente e non correggibile dall'utente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseTrustScore, TRUST_WEIGHTS } from '../src/services/trust/computeTrustScore.js';

test('i pesi sono quelli documentati e sommano a 1', () => {
  assert.equal(TRUST_WEIGHTS.heuristics, 0.45);
  assert.equal(TRUST_WEIGHTS.aiText, 0.45);
  assert.equal(TRUST_WEIGHTS.aiImages, 0.10);
  assert.equal(TRUST_WEIGHTS.heuristics + TRUST_WEIGHTS.aiText + TRUST_WEIGHTS.aiImages, 1);
});

test('con foto: media pesata delle tre componenti', () => {
  // 80*0.45 + 90*0.45 + 60*0.10 = 36 + 40.5 + 6 = 82.5 -> 83
  assert.equal(fuseTrustScore({ heuristics: 80, aiText: 90, aiImages: 60, hasImages: true }), 83);
});

test('senza foto: il punteggio immagini viene ignorato, non conta come zero', () => {
  const conZero = fuseTrustScore({ heuristics: 95, aiText: 95, aiImages: 0, hasImages: false });
  const conCinquanta = fuseTrustScore({ heuristics: 95, aiText: 95, aiImages: 50, hasImages: false });
  const conNull = fuseTrustScore({ heuristics: 95, aiText: 95, aiImages: null, hasImages: false });
  // Qualunque cosa dica l'AI sulle immagini è irrilevante se immagini non ce ne sono
  assert.equal(conZero, conCinquanta);
  assert.equal(conZero, conNull);
  assert.equal(conZero, 95);
});

test('senza foto: due componenti perfette danno 100 (prima davano 90)', () => {
  assert.equal(fuseTrustScore({ heuristics: 100, aiText: 100, aiImages: 0, hasImages: false }), 100);
});

test('regressione del caso reale: 86% senza foto risaliva per lo zero inventato', () => {
  // Vecchio comportamento: 95*0.45 + 90*0.45 + 0*0.10 = 83 (l'utente vedeva
  // un punteggio abbassato da una componente che non poteva esistere).
  const vecchio = Math.round(95 * 0.45 + 90 * 0.45 + 0 * 0.10);
  const nuovo = fuseTrustScore({ heuristics: 95, aiText: 90, aiImages: 0, hasImages: false });
  assert.ok(nuovo > vecchio, `nuovo ${nuovo} non è maggiore del vecchio ${vecchio}`);
  assert.equal(nuovo, 93); // (95*0.45 + 90*0.45) / 0.90
});

test('con foto: un punteggio immagini basso continua a pesare', () => {
  const conFotoScarse = fuseTrustScore({ heuristics: 95, aiText: 90, aiImages: 0, hasImages: true });
  const senzaFoto = fuseTrustScore({ heuristics: 95, aiText: 90, aiImages: 0, hasImages: false });
  assert.ok(conFotoScarse < senzaFoto, 'foto scarse devono pesare più di foto assenti');
});

test('valori mancanti o non numerici non producono NaN', () => {
  assert.equal(Number.isFinite(fuseTrustScore({ hasImages: false })), true);
  assert.equal(Number.isFinite(fuseTrustScore({ hasImages: true })), true);
  assert.equal(Number.isFinite(fuseTrustScore({ heuristics: 'x', aiText: null, aiImages: undefined, hasImages: true })), true);
});

test('il risultato resta nell\'intervallo 0..100 per input validi', () => {
  assert.equal(fuseTrustScore({ heuristics: 0, aiText: 0, aiImages: 0, hasImages: true }), 0);
  assert.equal(fuseTrustScore({ heuristics: 100, aiText: 100, aiImages: 100, hasImages: true }), 100);
  assert.equal(fuseTrustScore({ heuristics: 0, aiText: 0, aiImages: 0, hasImages: false }), 0);
});
