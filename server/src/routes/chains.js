// server/src/routes/chains.js
import express from "express";
import { findAndProposeChains } from "../models/chains.js";

export const chainsRouter = express.Router();

// Protetto da un secret condiviso, NON dal login utente: questo endpoint
// scansiona gli annunci di TUTTI gli utenti (serve il client service-role,
// vedi db.js), quindi non è pensato per essere chiamato dal client mobile
// ma da un job periodico/admin. Fail-closed: se CHAIN_CRON_SECRET non è
// configurato, l'endpoint rifiuta sempre — meglio un 503 esplicito che un
// endpoint di scansione globale accidentalmente pubblico.
function requireCronSecret(req, res, next) {
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

chainsRouter.post("/recompute", requireCronSecret, async (req, res) => {
  try {
    const out = await findAndProposeChains();
    return res.status(200).json(out);
  } catch (e) {
    console.error("[chains/recompute] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});
