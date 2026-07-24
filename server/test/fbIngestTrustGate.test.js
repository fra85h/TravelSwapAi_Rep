// Test per la regola "quali canali Facebook vengono controllati dal
// TrustScore prima di pubblicare, e con quale esito" (fbIngest.js).
// Copre la regressione: prima solo 'facebook:feed' passava dal gate, un
// annuncio confermato via 'facebook:messenger' andava live senza alcun
// controllo di contenuto/moderazione.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldGateChannel, evaluateTrustGate } from '../src/models/fbIngest.js';

test('shouldGateChannel: feed e messenger sono entrambi soggetti al TrustScore', () => {
  assert.equal(shouldGateChannel('facebook:feed'), true);
  assert.equal(shouldGateChannel('facebook:messenger'), true);
});

test('shouldGateChannel: canali non riconosciuti non sono gated', () => {
  assert.equal(shouldGateChannel('facebook:simulate'), false);
  assert.equal(shouldGateChannel(undefined), false);
  assert.equal(shouldGateChannel(''), false);
});

test('evaluateTrustGate: punteggio sopra soglia e nessun flag -> pubblicabile', () => {
  const out = evaluateTrustGate({ trustScore: 80, moderationFlagged: false }, 50);
  assert.deepEqual(out, { publishable: true, reason: null });
});

test('evaluateTrustGate: punteggio esattamente sulla soglia -> pubblicabile', () => {
  const out = evaluateTrustGate({ trustScore: 50, moderationFlagged: false }, 50);
  assert.equal(out.publishable, true);
});

test('evaluateTrustGate: punteggio sotto soglia -> scartato per low_trust_score', () => {
  const out = evaluateTrustGate({ trustScore: 30, moderationFlagged: false }, 50);
  assert.deepEqual(out, { publishable: false, reason: 'low_trust_score' });
});

test('evaluateTrustGate: contenuto flaggato dalla moderazione -> scartato anche con punteggio alto', () => {
  const out = evaluateTrustGate({ trustScore: 90, moderationFlagged: true }, 50);
  assert.deepEqual(out, { publishable: false, reason: 'moderation_flagged' });
});

test('evaluateTrustGate: moderazione ha priorità sul motivo se entrambi i problemi sono presenti', () => {
  const out = evaluateTrustGate({ trustScore: 10, moderationFlagged: true }, 50);
  assert.equal(out.reason, 'moderation_flagged');
});
