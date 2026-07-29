// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 8 "Funzionalità collaterali", step 40 "Notifiche email"): verifica
// che arrivi l'email "la tua proposta è stata accettata".
//
// Stesso approccio di notifyOfferReceived.test.js: si isola l'handler
// finale della route (server/src/routes/notify.js, POST /offer-accepted)
// e lo si chiama con un req/res fittizio, mock completo di Supabase,
// mailer e push.
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

test('Notifiche email: proposta accettata -> mail al proponente', async () => {
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
                    return { data: { id: OFFER_ID, type: 'buy', proposer_id: BUYER_B, to_listing_id: LISTING_ID, status: 'accepted' }, error: null };
                  }
                  if (table === 'listings') {
                    return { data: { user_id: SELLER_A, title: 'Roma → Milano, Frecciarossa 9506' }, error: null };
                  }
                  if (table === 'profiles') {
                    return { data: { email: 'proponente@example.com' }, error: null };
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
  const handler = lastHandler(notifyRouter, 'post', '/offer-accepted');

  // La chiama chi ACCETTA: il proprietario dell'annuncio target (SELLER_A).
  const req = { body: { offerId: OFFER_ID }, user: { id: SELLER_A } };
  const res = fakeRes();
  await handler(req, res);

  // Stesso "atteso" della checklist manuale, step 40.
  assert.equal(res.body.ok, true);
  assert.equal(res.body.sent, true);
  assert.equal(sentMails.length, 1);
  assert.equal(sentMails[0].to, 'proponente@example.com');
  assert.match(sentMails[0].subject, /La tua proposta è stata accettata/);

  mock.reset();
});

test("Notifiche email: solo il proprietario dell'annuncio può innescare l'invio (403)", async () => {
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
                    return { data: { id: OFFER_ID, type: 'buy', proposer_id: BUYER_B, to_listing_id: LISTING_ID, status: 'accepted' }, error: null };
                  }
                  if (table === 'listings') {
                    return { data: { user_id: SELLER_A, title: 'Roma → Milano' }, error: null };
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
  const handler = lastHandler(notifyRouter, 'post', '/offer-accepted');

  // Il proponente stesso (non il proprietario) prova a innescare la notifica.
  const req = { body: { offerId: OFFER_ID }, user: { id: BUYER_B } };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 403);

  mock.reset();
});
