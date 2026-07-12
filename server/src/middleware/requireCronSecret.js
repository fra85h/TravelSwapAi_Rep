// server/src/middleware/requireCronSecret.js
// Protegge gli endpoint di manutenzione periodica (scansionano dati di
// TUTTI gli utenti, non vanno esposti al client mobile) con un secret
// condiviso invece del login utente. Riusa la stessa variabile
// CHAIN_CRON_SECRET già configurata per lo swap a catena — un solo
// secret per tutti gli endpoint "solo cron", non serve moltiplicarli.
// Fail-closed: se il secret non è configurato, l'endpoint rifiuta
// sempre (503) invece di restare aperto per errore.
export function requireCronSecret(req, res, next) {
  const configured = process.env.CHAIN_CRON_SECRET;
  if (!configured) {
    return res.status(503).json({ error: "CHAIN_CRON_SECRET not configured" });
  }
  const provided = req.get("X-Cron-Secret") || "";
  if (provided !== configured) {
    return res.status(401).json({ error: "Invalid or missing X-Cron-Secret" });
  }
  next();
}
