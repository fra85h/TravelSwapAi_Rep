// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 8 "Funzionalità collaterali", step 40 "Notifiche email"): verifica
// che arrivi l'email "hai ricevuto una proposta".
//
// notifyRouter è una route Express (server/src/routes/notify.js), non una
// funzione esportata come i test precedenti: qui si isola l'HANDLER finale
// (l'ultimo middleware nello stack della route) e lo si chiama con un
// req/res fittizio, bypassando requireAuth/rateLimitNotify (già testati
// altrove) — stesso confine di test degli altri file di questa serie, solo
// applicato a una route invece che a un modulo. Mock completo di Supabase,
// mailer e push (nessuna chiamata di rete vera).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const SELLER_A = '11111111-1111-4111-8111-111111111111';
const BUYER_B = '22222222-2222-4222-8222-222222222222';
const LISTING_ID = '33333333-3333-4333-8333-333333333333';
const OFFER_ID = '44444444-4444-4444-8444-444444444444';

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

test('Notifiche email: proposta ricevuta -> mail al proprietario dell\'annuncio', async () => {
  const sentMails = [];
  mock.module('../src/lib/mailer.js', {
    namedExports: {
      mailerConfigured: () => true,
      sendMail: async (opts) => { sentMails.push(opts); return true; },
    },
  });
  mock.module('../src/lib/push.js', {
    namedExports: { sendExpoPush: async () => ({ sent: 0 }) },
  });
  mock.module('../src/db.js', {
    namedExports: {
      supabase: {
        from(table) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (table === 'offers') {
                    return { data: { id: OFFER_ID, type: 'buy', proposer_id: BUYER_B, to_listing_id: LISTING_ID, status: 'pending' }, error: null };
                  }
                  if (table === 'listings') {
                    return { data: { user_id: SELLER_A, title: 'Roma → Milano, Frecciarossa 9506' }, error: null };
                  }
                  if (table === 'profiles') {
                    return { data: { email: 'venditore@example.com' }, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
          };
        },
      },
    },
  });

  const { notifyRouter } = await import('../src/routes/notify.js');
  const handler = lastHandler(notifyRouter, 'post', '/offer-received');

  const req = { body: { offerId: OFFER_ID }, user: { id: BUYER_B } };
  const res = fakeRes();
  await handler(req, res);

  // Stesso "atteso" della checklist manuale, step 40.
  assert.equal(res.body.ok, true);
  assert.equal(res.body.sent, true);
  assert.equal(sentMails.length, 1);
  assert.equal(sentMails[0].to, 'venditore@example.com');
  assert.match(sentMails[0].subject, /Nuova proposta di acquisto/);
  assert.match(sentMails[0].text, /Hai ricevuto una proposta di acquisto/);

  mock.reset();
});

test("Notifiche email: chi non è il proponente non può innescare l'invio (403)", async () => {
  mock.module('../src/lib/mailer.js', {
    namedExports: { mailerConfigured: () => true, sendMail: async () => true },
  });
  mock.module('../src/lib/push.js', {
    namedExports: { sendExpoPush: async () => ({ sent: 0 }) },
  });
  mock.module('../src/db.js', {
    namedExports: {
      supabase: {
        from(table) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (table === 'offers') {
                    return { data: { id: OFFER_ID, type: 'buy', proposer_id: BUYER_B, to_listing_id: LISTING_ID, status: 'pending' }, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
          };
        },
      },
    },
  });

  const { notifyRouter } = await import('../src/routes/notify.js');
  const handler = lastHandler(notifyRouter, 'post', '/offer-received');

  // Un estraneo (né il proponente né il proprietario) prova a innescare la
  // notifica al posto del proponente.
  const req = { body: { offerId: OFFER_ID }, user: { id: '99999999-9999-4999-8999-999999999999' } };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 403);

  mock.reset();
});
