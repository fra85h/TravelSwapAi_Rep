// server/src/lib/mailer.js — invio email di servizio via Resend (API HTTPS).
//
// Prima usava SMTP diretto (nodemailer): Render blocca l'SMTP in uscita su
// ENTRAMBE le porte comuni (465 e 587) — verificato in produzione, prima
// con "connect ENETUNREACH" (un fix separato per la selezione IPv6 casuale
// di nodemailer), poi con "Connection timeout" anche forzando IPv4 e la
// porta 587: non è un problema di indirizzo o di porta, è un blocco della
// piattaforma di hosting per prevenire spam dai suoi container. Nessun fix
// lato client può aggirarlo: serve un trasporto che non usi SMTP.
//
// Resend usa un'API HTTPS (porta 443, mai bloccata da nessun hosting) —
// stesso motivo per cui il resto del progetto (OpenAI, Supabase) non ha
// mai avuto questo problema, essendo già tutto su HTTPS.
//
// Variabili d'ambiente richieste (da configurare su Render):
//   RESEND_API_KEY  chiave API dal pannello Resend (Dashboard → API Keys)
//   RESEND_FROM     mittente, es. "TravelSwap <onboarding@resend.dev>".
//                   Il dominio di test resend.dev funziona SOLO per
//                   mandare al proprio indirizzo verificato su Resend —
//                   per mandare a utenti reali serve un dominio proprio
//                   verificato su Resend (Dashboard → Domains, richiede
//                   aggiungere record SPF/DKIM al DNS del dominio).
const API_KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM = (process.env.RESEND_FROM || "").trim() || "TravelSwap <onboarding@resend.dev>";

export function mailerConfigured() {
  return !!API_KEY;
}

/** Invia una mail. Ritorna true/false, non lancia mai. */
export async function sendMail({ to, subject, text }) {
  if (!mailerConfigured()) {
    console.warn("[mailer] RESEND_API_KEY non configurata: mail non inviata:", subject);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[mailer] invio fallito:", res.status, body);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[mailer] invio fallito:", e?.message || e);
    return false;
  }
}
