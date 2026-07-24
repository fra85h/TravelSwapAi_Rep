// server/src/routes/priceCheck.js
import express from "express";
import { supabase } from "../db.js";
import { checkPriceWithAI } from "../ai/priceCheck.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { rateLimitPriceCheck } from "../middleware/rateLimit.js";

export const priceCheckRouter = express.Router();

// GET /api/listings/:id/price-check
priceCheckRouter.get("/api/listings/:id/price-check", requireAuth, rateLimitPriceCheck, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ available: false, reason: "missing_id" });
    const locale = ["it", "en", "es"].includes(req.query.locale) ? req.query.locale : "it";

    const { data: listing, error } = await supabase
      .from("listings")
      .select("id, type, price, currency, location, route_from, route_to, check_in, check_out, depart_at, arrive_at, title, description, purchase_price")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!listing) return res.status(404).json({ available: false, reason: "not_found" });

    const result = await checkPriceWithAI(listing, locale);
    return res.json(result);
  } catch (e) {
    console.error("[price-check][server] error", e);
    return res.status(500).json({ available: false, reason: "server_error" });
  }
});
