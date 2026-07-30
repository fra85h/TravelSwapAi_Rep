// Test funzionale: analisi threat-modeling fase post-transazione (sezione A,
// punto 4). POST /api/offers/recompute (server/src/routes/offers.js) ora
// chiama ANCHE release_all_stale_reservations, oltre a expire_old_offers —
// prima le prenotazioni 'accepted' scadute (7 giorni) venivano rilasciate
// solo se una delle due parti riapriva l'app (release_my_stale_reservations,
// scoped ad auth.uid()), senza nessun cron server-side di backstop.
//
// Stesso approccio dei test di server/src/routes/notify.js: si isola
// l'handler finale della route e lo si chiama con un req/res fittizio, mock
// completo di Supabase — nessuna chiamata di rete vera. Il gate
// requireCronSecret è testato separatamente come funzione pura.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { requireCronSecret } from '../src/middleware/requireCronSecret.js';

function lastHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route non trovata: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('requireCronSecret: nessun secret configurato -> 503 fail-closed', () => {
  const prev = process.env.CHAIN_CRON_SECRET;
  delete process.env.CHAIN_CRON_SECRET;
  const req = { get: () => '' };
  const res = fakeRes();
  requireCronSecret(req, res, () => { throw new Error('non deve chiamare next()'); });
  assert.equal(res.statusCode, 503);
  if (prev !== undefined) process.env.CHAIN_CRON_SECRET = prev;
});

test('requireCronSecret: secret sbagliato o mancante -> 401', () => {
  process.env.CHAIN_CRON_SECRET = 'il-vero-secret';
  const req = { get: () => 'secret-sbagliato' };
  const res = fakeRes();
  requireCronSecret(req, res, () => { throw new Error('non deve chiamare next()'); });
  assert.equal(res.statusCode, 401);
});

test('requireCronSecret: secret corretto -> chiama next()', () => {
  process.env.CHAIN_CRON_SECRET = 'il-vero-secret';
  const req = { get: () => 'il-vero-secret' };
  const res = fakeRes();
  let nextCalled = false;
  requireCronSecret(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('POST /offers/recompute: scade le offerte pending, rilascia le prenotazioni scadute E manda i due promemoria proattivi', async () => {
  // Analisi empatia/toni amichevoli, sezione C punto 10: prima nessuno
  // spingeva l'utente a confermare uno scambio accettato o a valutare una
  // transazione finalizzata.
  const calledRpc = [];
  mock.module('../src/db.js', {
    namedExports: {
      supabase: {
        rpc: async (fn) => {
          calledRpc.push(fn);
          if (fn === 'expire_old_offers') return { data: 3, error: null };
          if (fn === 'release_all_stale_reservations') return { data: 2, error: null };
          if (fn === 'remind_pending_confirmations') return { data: 5, error: null };
          if (fn === 'remind_pending_ratings') return { data: 4, error: null };
          return { data: null, error: null };
        },
      },
    },
  });

  const { offersRouter } = await import('../src/routes/offers.js');
  const handler = lastHandler(offersRouter, 'post', '/recompute');

  const req = {};
  const res = fakeRes();
  await handler(req, res);

  assert.deepEqual(calledRpc, [
    'expire_old_offers',
    'release_all_stale_reservations',
    'remind_pending_confirmations',
    'remind_pending_ratings',
  ]);
  assert.equal(res.body.expired, 3);
  assert.equal(res.body.releasedStale, 2);
  assert.equal(res.body.confirmReminders, 5);
  assert.equal(res.body.ratingReminders, 4);

  mock.reset();
});
