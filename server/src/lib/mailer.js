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

const HOST = (process.env.SMTP_HOST || "").trim();
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = (process.env.SMTP_USER || "").trim();
const PASS = (process.env.SMTP_PASS || "").trim();

const transporter = HOST && USER && PASS
  ? nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465, // 465 = SSL; 587 = STARTTLS
      auth: { user: USER, pass: PASS },
    })
  : null;

export function mailerConfigured() {
  return !!transporter;
}

/** Invia una mail. Ritorna true/false, non lancia mai. */
export async function sendMail({ to, subject, text }) {
  if (!transporter) {
    console.warn("[mailer] SMTP non configurato (SMTP_HOST/USER/PASS): mail non inviata:", subject);
    return false;
  }
  try {
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
