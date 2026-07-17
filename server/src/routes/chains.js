// server/src/routes/chains.js
import express from "express";
import { findAndProposeChains } from "../models/chains.js";
import { requireCronSecret } from "../middleware/requireCronSecret.js";
import { rateLimitChains } from "../middleware/rateLimit.js";

export const chainsRouter = express.Router();

// Protetto da un secret condiviso, NON dal login utente: questo endpoint
// scansiona gli annunci di TUTTI gli utenti (serve il client service-role,
// vedi db.js), quindi non è pensato per essere chiamato dal client mobile
// ma da un job periodico/admin.
chainsRouter.post("/recompute", rateLimitChains, requireCronSecret, async (req, res) => {
  try {
    const out = await findAndProposeChains();
    return res.status(200).json(out);
  } catch (e) {
    console.error("[chains/recompute] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});
