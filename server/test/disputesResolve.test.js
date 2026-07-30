// Test funzionale: analisi threat-modeling fase post-transazione (sezione A,
// punto 1). Prima non esisteva NESSUNA via per risolvere una disputa aperta
// da report_exchange_problem — l'unica uscita era annullare con
// cancel_accepted_offer_any, che ignora disputed_at e non lascia traccia
// della disputa. POST /api/disputes/resolve (server/src/routes/disputes.js)
// chiama la nuova RPC resolve_exchange_dispute, protetto da requireAdminSecret
// (secret condiviso, nessun concetto di ruolo admin nel DB — decisione presa
// con l'utente).
//
// mock.module()+import() dinamico ripetuto nello stesso file può restituire
// un modulo "stale" legato al PRIMO mock (già osservato in
// askListingQuestion.test.js): qui si mocka db.js e si importa la route UNA
// SOLA volta, delegando il comportamento della RPC a una variabile mutabile
// che ogni test riassegna — nessun secondo import, nessun rischio di cache.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { requireAdminSecret } from '../src/middleware/requireAdminSecret.js';

const OFFER_ID = '55555555-5555-4555-8555-555555555555';

let currentRpc = async () => ({ data: null, error: null });
mock.module('../src/db.js', {
  namedExports: {
    supabase: { rpc: (...args) => currentRpc(...args) },
  },
});
const { disputesRouter } = await import('../src/routes/disputes.js');

function lastHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route non trovata: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}
const handler = lastHandler(disputesRouter, 'post', '/resolve');
const chainHandler = lastHandler(disputesRouter, 'post', '/resolve-chain');

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('requireAdminSecret: nessun secret configurato -> 503 fail-closed', () => {
  const prev = process.env.ADMIN_ACTION_SECRET;
  delete process.env.ADMIN_ACTION_SECRET;
  const req = { get: () => '' };
  const res = fakeRes();
  requireAdminSecret(req, res, () => { throw new Error('non deve chiamare next()'); });
  assert.equal(res.statusCode, 503);
  if (prev !== undefined) process.env.ADMIN_ACTION_SECRET = prev;
});

test('requireAdminSecret: secret sbagliato o mancante -> 401', () => {
  process.env.ADMIN_ACTION_SECRET = 'il-vero-secret-admin';
  const req = { get: () => 'secret-sbagliato' };
  const res = fakeRes();
  requireAdminSecret(req, res, () => { throw new Error('non deve chiamare next()'); });
  assert.equal(res.statusCode, 401);
});

test('requireAdminSecret: secret corretto -> chiama next()', () => {
  process.env.ADMIN_ACTION_SECRET = 'il-vero-secret-admin';
  const req = { get: () => 'il-vero-secret-admin' };
  const res = fakeRes();
  let nextCalled = false;
  requireAdminSecret(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('POST /disputes/resolve: 400 se manca offerId o outcome', async () => {
  const res1 = fakeRes();
  await handler({ body: { outcome: 'resume' } }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = fakeRes();
  await handler({ body: { offerId: OFFER_ID } }, res2);
  assert.equal(res2.statusCode, 400);
});

test('POST /disputes/resolve: chiama resolve_exchange_dispute coi parametri giusti', async () => {
  const calls = [];
  currentRpc = async (fn, params) => {
    calls.push({ fn, params });
    return { data: { id: OFFER_ID, status: 'cancelled' }, error: null };
  };

  const req = { body: { offerId: OFFER_ID, outcome: 'cancel_favor_proposer', note: 'Il venditore non ha più risposto' } };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'resolve_exchange_dispute');
  assert.deepEqual(calls[0].params, {
    p_offer_id_text: OFFER_ID,
    p_outcome: 'cancel_favor_proposer',
    p_note: 'Il venditore non ha più risposto',
  });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.offer.status, 'cancelled');
});

test('POST /disputes/resolve: propaga l\'errore della RPC come 500', async () => {
  currentRpc = async () => ({ data: null, error: { message: 'Offer is not disputed' } });

  const req = { body: { offerId: OFFER_ID, outcome: 'resume' } };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 500);
});

// Threat-modeling fase post-transazione (sezione A, punto 3, parte 2/2):
// equivalente di /resolve ma per le segnalazioni sulle catene a 3
// (report_chain_problem) — qui non c'è nulla da annullare (la catena è già
// 'completed'), l'esito è solo informativo ('upheld' | 'dismissed').
test('POST /disputes/resolve-chain: 400 se manca disputeId o outcome', async () => {
  const res1 = fakeRes();
  await chainHandler({ body: { outcome: 'upheld' } }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = fakeRes();
  await chainHandler({ body: { disputeId: 'dispute-1' } }, res2);
  assert.equal(res2.statusCode, 400);
});

test('POST /disputes/resolve-chain: chiama resolve_chain_dispute coi parametri giusti', async () => {
  const calls = [];
  currentRpc = async (fn, params) => {
    calls.push({ fn, params });
    return { data: { id: 'dispute-1', resolution: 'upheld' }, error: null };
  };

  const req = { body: { disputeId: 'dispute-1', outcome: 'upheld', note: 'Confermato dal tracking del corriere' } };
  const res = fakeRes();
  await chainHandler(req, res);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'resolve_chain_dispute');
  assert.deepEqual(calls[0].params, {
    p_dispute_id: 'dispute-1',
    p_outcome: 'upheld',
    p_note: 'Confermato dal tracking del corriere',
  });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dispute.resolution, 'upheld');
});
