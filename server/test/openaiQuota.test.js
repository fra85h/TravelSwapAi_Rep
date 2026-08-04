// Credito OpenAI esaurito: riconoscerlo, non ritentarlo, non raccontarlo.
//
// Caso reale del 4 agosto: l'import PDF falliva e il messaggio mostrato
// all'utente era "429 You have no credits remaining. Add credits to
// continue using the API at https://platform.openai.com/settings/
// organization/billing/". Ottimo per noi, pessimo per chi usa l'app: non
// gli dice cosa fare, e intanto gli racconta con quale fornitore lavoriamo
// e che abbiamo il conto scoperto.
import test from 'node:test';
import assert from 'node:assert/strict';

import { isQuotaExhausted, userFacingAIError } from '../src/lib/openaiClient.js';

const quotaErr = () => Object.assign(
  new Error('429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.'),
  { status: 429 },
);

test('riconosce il credito esaurito dal messaggio', () => {
  assert.equal(isQuotaExhausted(quotaErr()), true);
});

test('riconosce il credito esaurito dal codice applicativo', () => {
  const e = Object.assign(new Error('quota'), { status: 429, code: 'insufficient_quota' });
  assert.equal(isQuotaExhausted(e), true);
});

test('NON confonde il limite di frequenza col credito esaurito', () => {
  // Sono lo stesso codice HTTP ma due cose opposte: il primo passa
  // aspettando, il secondo no.
  const rateLimit = Object.assign(new Error('Rate limit reached for requests'), { status: 429 });
  assert.equal(isQuotaExhausted(rateLimit), false);
});

test('un errore di altro tipo non è mai credito esaurito', () => {
  for (const status of [400, 401, 500, 520, undefined]) {
    assert.equal(isQuotaExhausted(Object.assign(new Error('x'), { status })), false);
  }
  assert.equal(isQuotaExhausted(null), false);
});

test("all'utente non arrivano né il fornitore né la fatturazione", () => {
  const msg = userFacingAIError(quotaErr());
  assert.doesNotMatch(msg, /openai/i, 'il nome del fornitore non deve uscire');
  assert.doesNotMatch(msg, /credit|billing|quota/i, 'lo stato del nostro conto non deve uscire');
  assert.doesNotMatch(msg, /https?:\/\//, 'nessun link a pannelli che non sono suoi');
  assert.match(msg, /riprova|a mano/i, "deve dire cosa può fare adesso");
});

test('per gli altri errori il messaggio originale resta, serve a diagnosticare', () => {
  const e = Object.assign(new Error('Il servizio AI ha risposto in un formato non valido.'), { status: 502 });
  assert.equal(userFacingAIError(e), 'Il servizio AI ha risposto in un formato non valido.');
});
