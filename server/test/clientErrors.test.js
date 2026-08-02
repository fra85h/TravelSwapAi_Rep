// L'endpoint che raccoglie i crash dell'app web.
//
// È l'unico endpoint senza autenticazione che accetta testo libero da
// chiunque, quindi la parte da verificare non è "funziona" ma "cosa
// rifiuta e cosa taglia": quello che arriva qui viene da un browser, cioè
// da chiunque sappia l'indirizzo.
import test from 'node:test';
import assert from 'node:assert/strict';

import { clientErrorsRouter } from '../src/routes/clientErrors.js';

// Percorre lo stack del router come farebbe express, senza montarlo su un
// server vero: qui interessa la logica dell'handler, non il trasporto.
function callRoute(body, { ip = '203.0.113.1' } = {}) {
  const layer = clientErrorsRouter.stack.find((l) => l.route?.path === '/client-errors');
  assert.ok(layer, 'la rotta /client-errors deve esistere');
  const handlers = layer.route.stack.map((s) => s.handle);

  const req = { body, ip, method: 'POST', user: undefined };
  const res = {
    statusCode: 200,
    payload: undefined,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(p) { this.payload = p; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };

  let i = 0;
  const next = () => {
    const h = handlers[i++];
    if (h) h(req, res, next);
  };
  next();
  return res;
}

test('un errore valido viene accettato senza corpo di risposta', () => {
  const res = callRoute({ message: 'Cannot read properties of undefined' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
});

test('senza messaggio si rifiuta: un errore senza testo non dice niente', () => {
  const res = callRoute({ stack: 'at qualcosa' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, 'message_required');
});

test('un messaggio non testuale viene rifiutato come mancante', () => {
  for (const message of [null, 42, {}, [], '']) {
    const res = callRoute({ message });
    assert.equal(res.statusCode, 400, `rifiutato: ${JSON.stringify(message)}`);
  }
});

test('un corpo assente non fa esplodere l\'endpoint', () => {
  const res = callRoute(undefined);
  assert.equal(res.statusCode, 400);
});

test('messaggi e stack enormi non passano interi', () => {
  // Senza tetto, un client rotto in ciclo potrebbe spedire megabyte di
  // testo per ogni errore. Il taglio avviene prima di inoltrare.
  const res = callRoute({ message: 'x'.repeat(50000), stack: 'y'.repeat(50000) });
  assert.equal(res.statusCode, 204);
});

test('il limite di frequenza scatta e non lascia passare tutto', () => {
  const ip = '198.51.100.7'; // IP dedicato: i bucket sono per chiave
  let accepted = 0;
  let limited = 0;
  for (let i = 0; i < 40; i++) {
    const res = callRoute({ message: `errore ${i}` }, { ip });
    if (res.statusCode === 429) limited += 1;
    else accepted += 1;
  }
  assert.ok(limited > 0, 'oltre il tetto le richieste devono essere respinte');
  assert.ok(accepted < 40, 'non devono passare tutte');
});
