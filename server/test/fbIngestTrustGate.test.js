// Test per la regola "quali canali Facebook/Instagram vengono controllati dal
// TrustScore prima di pubblicare, e con quale esito" (fbIngest.js).
// Copre la regressione: prima solo 'facebook:feed' passava dal gate, un
// annuncio confermato via 'facebook:messenger' andava live senza alcun
// controllo di contenuto/moderazione. Stessa regola estesa a
// 'instagram:messenger' quando è stato aggiunto il canale Instagram DM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldGateChannel, evaluateTrustGate } from '../src/models/fbIngest.js';

test('shouldGateChannel: feed, messenger e instagram sono tutti soggetti al TrustScore', () => {
  assert.equal(shouldGateChannel('facebook:feed'), true);
  assert.equal(shouldGateChannel('facebook:messenger'), true);
  assert.equal(shouldGateChannel('instagram:messenger'), true);
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

/* ===== "Non verificato" non è "verificato male" ===== */

test('verifica non completata: l\'annuncio NON si pubblica adesso', () => {
  // Prima questo caso arrivava qui con trustScore 55 (il vecchio tetto), che
  // è SOPRA la soglia di default (50): il gate lo lasciava passare e
  // l'annuncio finiva online proprio quando non era stato controllato.
  const esito = evaluateTrustGate({ verificationPending: true, trustScore: null });
  assert.equal(esito.publishable, false);
  assert.equal(esito.reason, 'verification_pending');
});

test('un punteggio assente vale come verifica non completata', () => {
  // Difesa dal caso in cui il flag non arrivi ma il punteggio manchi: senza
  // un numero non c'è niente da confrontare con la soglia.
  for (const scored of [{ trustScore: null }, { trustScore: undefined }, {}]) {
    assert.equal(evaluateTrustGate(scored).reason, 'verification_pending');
  }
});

test('il motivo distingue il guasto nostro dalla bocciatura', () => {
  // Sono due esiti diversi e il chiamante deve poterli distinguere: uno chiede
  // all'utente di correggere, l'altro no.
  assert.equal(evaluateTrustGate({ trustScore: 10 }).reason, 'low_trust_score');
  assert.equal(evaluateTrustGate({ verificationPending: true }).reason, 'verification_pending');
  assert.equal(evaluateTrustGate({ moderationFlagged: true, trustScore: 90 }).reason, 'moderation_flagged');
});

test('la moderazione resta prioritaria anche senza punteggio', () => {
  const esito = evaluateTrustGate({ moderationFlagged: true, verificationPending: true, trustScore: null });
  assert.equal(esito.reason, 'moderation_flagged');
});
