// server/src/routes/savedSearches.js
import express from "express";
import { findAndNotifyMatches } from "../models/savedSearches.js";
import { requireCronSecret } from "../middleware/requireCronSecret.js";
import { withCronLease } from "../middleware/withCronLease.js";
import { rateLimitSavedSearches } from "../middleware/rateLimit.js";

export const savedSearchesRouter = express.Router();

// Come /api/chains/recompute: protetto da secret condiviso, non dal login
// utente — scansiona gli annunci di tutti gli utenti, non va chiamato dal
// client mobile.
savedSearchesRouter.post("/recompute", rateLimitSavedSearches, requireCronSecret, withCronLease("saved-searches", { ttlSeconds: 900 }), async (req, res) => {
  try {
    const out = await findAndNotifyMatches();
    return res.status(200).json(out);
  } catch (e) {
    console.error("[saved-searches/recompute] error:", e);
    return res.status(500).json({ error: 'Errore interno' });
  }
});
