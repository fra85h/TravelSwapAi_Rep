// Sostituisce il vecchio SMTP diretto (nodemailer): Render blocca l'SMTP in
// uscita su entrambe le porte comuni (465 e 587), verificato in produzione
// — prima "connect ENETUNREACH" (scelta casuale IPv6 di nodemailer, fix
// separato), poi "Connection timeout" anche forzando IPv4 e la porta 587.
// Non un problema di indirizzo/porta: un blocco della piattaforma per
// prevenire spam. Resend usa un'API HTTPS (porta 443, mai bloccata),
// stesso motivo per cui OpenAI/Supabase non hanno mai avuto questo
// problema.
//
// global.fetch è nativo in Node 18+ (non un modulo importato): si sovrascrive
// e ripristina direttamente, nessun mock.module necessario.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('mailer: mailerConfigured riflette solo la presenza di RESEND_API_KEY', async () => {
  delete process.env.RESEND_API_KEY;
  const { mailerConfigured } = await import('../src/lib/mailer.js?t=1');
  assert.equal(mailerConfigured(), false);
});

test('mailer: sendMail chiama l\'API Resend coi parametri giusti e ritorna true su 200', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM = 'TravelSwapAI <onboarding@resend.dev>';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true };
  };

  try {
    const { mailerConfigured, sendMail } = await import('../src/lib/mailer.js?t=2');
    assert.equal(mailerConfigured(), true);

    const ok = await sendMail({ to: 'dest@example.com', subject: 'Ciao', text: 'corpo' });
    assert.equal(ok, true);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(body.to, ['dest@example.com']);
    assert.equal(body.from, 'TravelSwapAI <onboarding@resend.dev>');
    assert.equal(body.subject, 'Ciao');
    assert.equal(body.text, 'corpo');
  } finally {
    global.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
  }
});

test('mailer: sendMail ritorna false (mai un\'eccezione) se Resend risponde con errore o la fetch fallisce', async () => {
  process.env.RESEND_API_KEY = 'test-key';

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, text: async () => '{"message":"invalid key"}' });

  try {
    const { sendMail } = await import('../src/lib/mailer.js?t=3');
    const ok = await sendMail({ to: 'dest@example.com', subject: 'Ciao', text: 'corpo' });
    assert.equal(ok, false);
  } finally {
    global.fetch = originalFetch;
  }

  global.fetch = async () => { throw new Error('network down'); };
  try {
    const { sendMail } = await import('../src/lib/mailer.js?t=4');
    const ok = await sendMail({ to: 'dest@example.com', subject: 'Ciao', text: 'corpo' });
    assert.equal(ok, false);
  } finally {
    global.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  }
});
