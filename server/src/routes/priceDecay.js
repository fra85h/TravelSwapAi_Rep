// server/src/routes/priceDecay.js
import express from "express";
import { recomputeDynamicPrices } from "../models/priceDecay.js";
import { requireCronSecret } from "../middleware/requireCronSecret.js";
import { rateLimitPriceDecay } from "../middleware/rateLimit.js";

export const priceDecayRouter = express.Router();

// Protetto da un secret condiviso, NON dal login utente: questo endpoint
// scansiona gli annunci di TUTTI gli utenti (serve il client service-role),
// stesso schema di chains.js/savedSearches.js/offers.js — pensato per un
// job periodico, non per essere chiamato dal client mobile.
priceDecayRouter.post("/recompute", rateLimitPriceDecay, requireCronSecret, async (req, res) => {
  try {
    const out = await recomputeDynamicPrices();
    return res.status(200).json(out);
  } catch (e) {
    console.error("[price-decay/recompute] error:", e);
    return res.status(500).json({ error: "Errore interno" });
  }
});
