// server/src/lib/mailer.js — invio email di servizio (notifiche segnalazioni).
// Fail-safe: se le variabili SMTP non sono configurate, sendMail è un no-op
// che logga un warning — nessuna feature deve rompersi per la mail mancante.
//
// Variabili d'ambiente richieste (da configurare su Render):
//   SMTP_HOST  es. smtp.gmail.com
//   SMTP_PORT  es. 465 (SSL) o 587 (STARTTLS)
//   SMTP_USER  es. tuoindirizzo@gmail.com
//   SMTP_PASS  app password (per Gmail: Account Google → Sicurezza → Password per le app)
//   REPORT_NOTIFY_TO  indirizzo che riceve le notifiche (può essere lo stesso di SMTP_USER)
import nodemailer from "nodemailer";
import dns from "node:dns";

const HOST = (process.env.SMTP_HOST || "").trim();
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = (process.env.SMTP_USER || "").trim();
const PASS = (process.env.SMTP_PASS || "").trim();

export function mailerConfigured() {
  return !!(HOST && USER && PASS);
}

// Bug reale in produzione (Render): nodemailer (v9) risolve SEMPRE sia
// l'indirizzo IPv4 sia quello IPv6 dell'host SMTP, poi ne sceglie UNO A
// CASO dalla lista combinata (node_modules/nodemailer/lib/shared/index.js,
// funzione resolveHostname — Math.random() alla riga 83). Un'opzione
// "family" passata a createTransport() NON viene mai letta da questo
// percorso: non ha alcun effetto, a differenza di quanto normalmente ci si
// aspetterebbe da altre librerie di rete. Se il container non ha
// connettività IPv6 in uscita (come su Render), ogni volta che la
// selezione casuale cade su un indirizzo IPv6 la connessione fallisce con
// "connect ENETUNREACH" — capita a intermittenza, non sempre.
//
// Fix: risolviamo l'host NOI STESSI con dns.resolve4 (garantito solo IPv4)
// e passiamo l'indirizzo IP letterale a nodemailer come "host" — a quel
// punto nodemailer riconosce che è già un IP (net.isIP) e salta del tutto
// la propria risoluzione DNS interna, quindi anche la scelta casuale.
// tls.servername resta l'hostname vero, altrimenti la verifica del
// certificato TLS (SNI) fallirebbe contro un IP nudo.
async function resolveIPv4(hostname) {
  try {
    const addresses = await dns.promises.resolve4(hostname);
    return addresses?.[0] || null;
  } catch (e) {
    console.warn("[mailer] risoluzione IPv4 fallita, ripiego sull'hostname:", e?.message || e);
    return null;
  }
}

/** Invia una mail. Ritorna true/false, non lancia mai. */
export async function sendMail({ to, subject, text }) {
  if (!mailerConfigured()) {
    console.warn("[mailer] SMTP non configurato (SMTP_HOST/USER/PASS): mail non inviata:", subject);
    return false;
  }
  try {
    const ipv4Host = await resolveIPv4(HOST);
    const transporter = nodemailer.createTransport({
      host: ipv4Host || HOST,
      port: PORT,
      secure: PORT === 465, // 465 = SSL; 587 = STARTTLS
      auth: { user: USER, pass: PASS },
      tls: { servername: HOST },
    });
    await transporter.sendMail({
      from: `"TravelSwapAI" <${USER}>`,
      to,
      subject,
      text,
    });
    return true;
  } catch (e) {
    console.error("[mailer] invio fallito:", e?.message || e);
    return false;
  }
}
