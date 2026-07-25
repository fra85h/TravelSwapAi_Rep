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

test('verifica non riuscita: non si chiede all\'utente di rifare nulla', () => {
  // È un guasto nostro, non un errore suo: la sessione si svuota (l'annuncio è
  // già salvato in bozza) e il messaggio non deve suonare come un rifiuto.
  const out = decideMessengerPublishOutcome({ id: 'abc', pending: true });
  assert.equal(out.clearSession, true);
  assert.match(out.message, /verifica automatica/i);
  assert.doesNotMatch(out.message, /non ho pubblicato/i);
  assert.doesNotMatch(out.message, /correggere/i);
});

test('bocciatura e verifica non riuscita danno messaggi diversi', () => {
  const scartato = decideMessengerPublishOutcome({ skipped: true });
  const sospeso = decideMessengerPublishOutcome({ pending: true });
  assert.notEqual(scartato.message, sospeso.message);
  // Solo la bocciatura tiene viva la sessione, perché lì c'è da correggere.
  assert.equal(scartato.clearSession, false);
  assert.equal(sospeso.clearSession, true);
});
