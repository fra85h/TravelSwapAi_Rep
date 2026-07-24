// Test per la regola "cosa dire all'utente Messenger e se svuotare la
// sessione" dopo aver provato a pubblicare (lib/messengerPublishOutcome.js).
// Copre la regressione: prima del gate TrustScore su Messenger, il bot
// mandava sempre il messaggio di successo, anche quando in teoria l'annuncio
// non fosse stato inserito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideMessengerPublishOutcome } from '../src/lib/messengerPublishOutcome.js';

test('risultato pubblicato (con id) -> messaggio di successo e sessione svuotata', () => {
  const out = decideMessengerPublishOutcome({ id: 'abc-123' });
  assert.equal(out.clearSession, true);
  assert.match(out.message, /pubblicato con successo/);
});

test('risultato scartato dal TrustScore -> messaggio di avviso e sessione NON svuotata', () => {
  const out = decideMessengerPublishOutcome({ id: null, skipped: true, reason: 'low_trust_score', trustScore: 30 });
  assert.equal(out.clearSession, false);
  assert.match(out.message, /[Nn]on ho pubblicato/);
});

test('risultato scartato per moderazione -> stesso comportamento (sessione preservata)', () => {
  const out = decideMessengerPublishOutcome({ id: null, skipped: true, reason: 'moderation_flagged', trustScore: 90 });
  assert.equal(out.clearSession, false);
});

test('risultato mancante/undefined non esplode e viene trattato come successo', () => {
  const out = decideMessengerPublishOutcome(undefined);
  assert.equal(out.clearSession, true);
});
