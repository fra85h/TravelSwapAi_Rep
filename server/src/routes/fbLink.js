// server/src/routes/fbLink.js — l'utente loggato chiede un codice per
// collegare il proprio account al bot Messenger della Pagina Facebook.
import express from "express";
import { createLinkCode } from "../models/fbLink.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { makeRateLimiter } from "../middleware/rateLimit.js";

export const fbLinkRouter = express.Router();

// Pochi tentativi bastano: è un flusso che l'utente fa una volta sola.
const rateLimitFbLink = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 5, name: "richieste di codice" });

fbLinkRouter.post("/code", requireAuth, rateLimitFbLink, async (req, res) => {
  try {
    const out = await createLinkCode(req.user.id);
    return res.status(200).json(out);
  } catch (e) {
    console.error("[fb-link/code] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});
