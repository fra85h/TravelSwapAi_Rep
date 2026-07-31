// Bug reale in produzione (Render): smtp.gmail.com risolve anche su IPv6,
// ma il container non ha connettività IPv6 in uscita — sendMail falliva
// sempre con "connect ENETUNREACH <indirizzo IPv6>", ancora prima di un
// controllo delle credenziali (nessuna email è mai partita). Fix: forzare
// family:4 (IPv4) nella configurazione del transporter nodemailer.
//
// Non testiamo una connessione SMTP reale (impossibile in CI, e non è il
// bug in sé): verifichiamo solo che family:4 resti sempre nella
// configurazione passata a nodemailer.createTransport, così un futuro
// refactor non lo perda per distrazione com'è successo la prima volta.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('mailer: forza IPv4 nella connessione SMTP (fix ENETUNREACH su IPv6 rotto)', async () => {
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_USER = 'test@example.com';
  process.env.SMTP_PASS = 'secret';

  let capturedOptions = null;
  mock.module('nodemailer', {
    defaultExport: {
      createTransport: (opts) => {
        capturedOptions = opts;
        return { sendMail: async () => {} };
      },
    },
  });

  const { mailerConfigured } = await import('../src/lib/mailer.js');

  assert.equal(mailerConfigured(), true);
  assert.ok(capturedOptions, 'nodemailer.createTransport non è mai stato chiamato');
  assert.equal(capturedOptions.family, 4, 'manca family:4 — il transporter tornerebbe a provare anche IPv6');
  assert.equal(capturedOptions.host, 'smtp.gmail.com');
  assert.equal(capturedOptions.secure, true);

  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});
