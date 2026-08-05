// reportFault: i guasti "gestiti", quelli che restavano invisibili.
//
// Il tracciamento errori riceveva solo i crash. Ma i quattro guasti veri
// dei primi giorni di agosto — credito OpenAI esaurito, 520 sull'import
// PDF, reset password rotto — erano tutti CATTURATI dal codice, che
// proseguiva con un ripiego pulito. Il ripiego salvava l'utente e il
// silenzio seppelliva il problema: nessuno ne sapeva niente finché non lo
// incontrava di persona il proprietario dell'app.
import test from 'node:test';
import assert from 'node:assert/strict';

import { reportFault, monitoringEnabled, __resetFaultThrottleForTests } from '../src/lib/monitoring.js';

test('senza Sentry configurato non parte niente verso l\'esterno', () => {
  // I test girano senza SENTRY_DSN: reportFault deve limitarsi al log.
  assert.equal(monitoringEnabled(), false);
});

test('non lancia mai, con qualunque argomento', () => {
  __resetFaultThrottleForTests();
  // Sta dentro una catch: se esplodesse, trasformerebbe un guasto gestito
  // in un crash — esattamente il contrario del suo scopo.
  assert.doesNotThrow(() => reportFault('scope', new Error('boom')));
  assert.doesNotThrow(() => reportFault('scope', null));
  assert.doesNotThrow(() => reportFault('scope', undefined));
  assert.doesNotThrow(() => reportFault('scope', 'una stringa'));
  assert.doesNotThrow(() => reportFault('scope', { status: 500 }));
  assert.doesNotThrow(() => reportFault(undefined, new Error('x')));
});

test('non restituisce niente su cui il chiamante possa contare', () => {
  __resetFaultThrottleForTests();
  assert.equal(reportFault('scope', new Error('x')), undefined);
});

test('accetta un contesto senza usarlo per decidere qualcosa', () => {
  __resetFaultThrottleForTests();
  assert.doesNotThrow(() => reportFault('mailer', new Error('invio fallito'), { body: 'dettagli' }));
});
