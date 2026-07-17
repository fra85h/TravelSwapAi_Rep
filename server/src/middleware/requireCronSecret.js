// server/src/middleware/requireCronSecret.js
// Protegge gli endpoint di manutenzione periodica (scansionano dati di
// TUTTI gli utenti, non vanno esposti al client mobile) con un secret
// condiviso invece del login utente. Riusa la stessa variabile
// CHAIN_CRON_SECRET già configurata per lo swap a catena — un solo
// secret per tutti gli endpoint "solo cron", non serve moltiplicarli.
// Fail-closed: se il secret non è configurato, l'endpoint rifiuta
// sempre (503) invece di restare aperto per errore.
import crypto from "crypto";

// Confronto a tempo costante: `!==` su stringa esce al primo carattere
// diverso, rivelando via timing quanti caratteri iniziali sono corretti.
function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // confronto fittizio a lunghezza costante, per non rivelare via timing
    // nemmeno la lunghezza del secret quando le stringhe differiscono
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function requireCronSecret(req, res, next) {
  const configured = process.env.CHAIN_CRON_SECRET;
  if (!configured) {
    return res.status(503).json({ error: "CHAIN_CRON_SECRET not configured" });
  }
  const provided = req.get("X-Cron-Secret") || "";
  if (!timingSafeEqualStr(provided, configured)) {
    return res.status(401).json({ error: "Invalid or missing X-Cron-Secret" });
  }
  next();
}
