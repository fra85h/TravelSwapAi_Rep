// server/src/middleware/requireAdminSecret.js
// Protegge le azioni amministrative manuali (es. risolvere una
// contestazione) con un secret condiviso invece del login utente — nessun
// concetto di "ruolo admin" esiste ancora nel DB (verificato: profiles non
// ha nessuna colonna is_admin/role). Secret DISTINTO da CHAIN_CRON_SECRET
// (requireCronSecret.js): quello copre job periodici automatici, questo
// azioni puntuali decise a mano da chi gestisce la piattaforma — ruotarne
// uno non deve invalidare l'altro.
//
// Stessa logica fail-closed e confronto a tempo costante di
// requireCronSecret.
import crypto from "crypto";

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function requireAdminSecret(req, res, next) {
  const configured = process.env.ADMIN_ACTION_SECRET;
  if (!configured) {
    return res.status(503).json({ error: "ADMIN_ACTION_SECRET not configured" });
  }
  const provided = req.get("X-Admin-Secret") || "";
  if (!timingSafeEqualStr(provided, configured)) {
    return res.status(401).json({ error: "Invalid or missing X-Admin-Secret" });
  }
  next();
}
