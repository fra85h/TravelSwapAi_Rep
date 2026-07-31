// Bug reale in produzione (Render), in due tempi:
//
// 1) Un primo tentativo di fix aggiungeva family:4 a
//    nodemailer.createTransport(), assumendo (erroneamente) che nodemailer
//    onorasse quell'opzione per limitare la risoluzione DNS a IPv4. Non è
//    così: leggendo node_modules/nodemailer/lib/shared/index.js
//    (resolveHostname) si vede che nodemailer risolve SEMPRE sia IPv4 sia
//    IPv6 e sceglie un indirizzo A CASO dalla lista combinata
//    (Math.random(), riga 83) — "family" non viene mai letto. L'email
//    continuava a fallire a intermittenza con "connect ENETUNREACH
//    <indirizzo IPv6>" ogni volta che il sorteggio cadeva su IPv6 (il
//    container Render non ha connettività IPv6 in uscita).
//
// 2) Fix vero: risolvere l'host NOI STESSI con dns.resolve4 (garantito
//    solo IPv4) e passare l'indirizzo letterale a nodemailer come "host"
//    — a quel punto nodemailer riconosce che è già un IP (net.isIP) e
//    salta del tutto la propria risoluzione interna. tls.servername
//    preserva l'hostname vero per la verifica SNI/certificato.
//
// Non testiamo una vera connessione SMTP (impossibile in CI, e non è il
// bug in sé): verifichiamo solo che sendMail() risolva l'host in IPv4 e lo
// passi a nodemailer.createTransport, con servername corretto — e che in
// caso di risoluzione fallita ripieghi sull'hostname originale invece di
// esplodere.
//
// Un solo mock.module + import per file (pattern già verificato sicuro in
// questa sessione contro la staleness ESM): il comportamento di
// dns.resolve4 è delegato a una variabile mutabile che ogni test riassegna.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

process.env.SMTP_HOST = 'smtp.gmail.com';
process.env.SMTP_PORT = '465';
process.env.SMTP_USER = 'test@example.com';
process.env.SMTP_PASS = 'secret';

let resolve4Impl = async () => ['142.250.1.109'];
mock.module('node:dns', {
  namedExports: {
    promises: { resolve4: (...args) => resolve4Impl(...args) },
  },
});

let capturedOptions = null;
let capturedMail = null;
mock.module('nodemailer', {
  defaultExport: {
    createTransport: (opts) => {
      capturedOptions = opts;
      return { sendMail: async (mail) => { capturedMail = mail; } };
    },
  },
});

const { mailerConfigured, sendMail } = await import('../src/lib/mailer.js');

test('mailer: risolve l\'host in IPv4 e lo passa a nodemailer, preservando servername per il TLS', async () => {
  resolve4Impl = async () => ['142.250.1.109'];
  assert.equal(mailerConfigured(), true);

  const ok = await sendMail({ to: 'dest@example.com', subject: 'Ciao', text: 'corpo' });
  assert.equal(ok, true);

  // L'host passato a nodemailer è l'IP risolto, NON l'hostname — così
  // nodemailer salta la propria (difettosa) risoluzione DNS interna.
  assert.equal(capturedOptions.host, '142.250.1.109');
  // servername resta l'hostname vero: altrimenti il TLS/SNI verificherebbe
  // il certificato contro un IP nudo e fallirebbe.
  assert.equal(capturedOptions.tls.servername, 'smtp.gmail.com');
  assert.equal(capturedOptions.secure, true);
  assert.equal(capturedMail.to, 'dest@example.com');
});

test('mailer: se la risoluzione IPv4 fallisce, ripiega sull\'hostname invece di esplodere', async () => {
  resolve4Impl = async () => { throw new Error('ENOTFOUND'); };

  const ok = await sendMail({ to: 'dest@example.com', subject: 'Ciao', text: 'corpo' });
  assert.equal(ok, true);
  assert.equal(capturedOptions.host, 'smtp.gmail.com');
});
