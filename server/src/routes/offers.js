// server/src/routes/offers.js
import express from "express";
import { supabase } from "../db.js";
import { requireCronSecret } from "../middleware/requireCronSecret.js";
import { rateLimitOffers } from "../middleware/rateLimit.js";

export const offersRouter = express.Router();

// Come /api/chains/recompute e /api/saved-searches/recompute: protetto da
// secret condiviso, non dal login utente — scade le proposte pending di
// TUTTI gli utenti (48h da expires_at, vedi supabase/migrations/
// 20260718110001_offers_timeout.sql). Facoltativo: la scadenza pigra già
// applicata da accept/decline_offer_any e dalle liste di Attività basta
// per la correttezza anche se questo endpoint non viene mai chiamato.
offersRouter.post("/recompute", rateLimitOffers, requireCronSecret, async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data, error } = await supabase.rpc("expire_old_offers");
    if (error) throw error;
    return res.status(200).json({ expired: data ?? 0 });
  } catch (e) {
    console.error("[offers/recompute] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});
