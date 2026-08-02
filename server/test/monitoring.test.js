// Il tracciamento errori deve essere INERTE quando non è configurato.
//
// È la proprietà che rende sicuro averlo nel codice: i test girano senza
// SENTRY_DSN, lo sviluppo locale pure, e in nessuno dei due casi devono
// partire dati verso un fornitore esterno. Un `captureError` che esplode o
// che parla con la rete quando non dovrebbe trasformerebbe uno strumento
// diagnostico in una fonte di guasti.
import test from 'node:test';
import assert from 'node:assert/strict';

import { captureError, captureMessage, monitoringEnabled } from '../src/lib/monitoring.js';

test('senza SENTRY_DSN il tracciamento è spento', () => {
  // I test non definiscono SENTRY_DSN: se questa asserzione fallisce
  // significa che l'ambiente di test sta per parlare con Sentry davvero.
  assert.equal(monitoringEnabled(), false);
});

test('captureError non lancia mai, nemmeno con argomenti assurdi', () => {
  assert.doesNotThrow(() => captureError(new Error('boom')));
  assert.doesNotThrow(() => captureError(null));
  assert.doesNotThrow(() => captureError(undefined, { contesto: 'nessuno' }));
  assert.doesNotThrow(() => captureError('non è un errore'));
});

test('captureMessage non lancia mai', () => {
  assert.doesNotThrow(() => captureMessage('quota quasi esaurita'));
  assert.doesNotThrow(() => captureMessage(null, { extra: 1 }));
});

test('captureError non restituisce niente su cui il chiamante possa contare', () => {
  // Il valore di ritorno non fa parte del contratto: chi chiama deve poter
  // ignorare il risultato senza cambiare comportamento fra ambienti.
  assert.equal(captureError(new Error('x')), undefined);
});
