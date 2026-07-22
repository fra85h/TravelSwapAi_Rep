import express from "express";
import { isUUID } from "../util/uuid.js";
import {
  // usa la versione che hai implementato: SQL o JS
  recomputeUserSnapshot,
  getUserSnapshot,
  recomputeMatches,              // ⬅️ AGGIUNTO
  propagateListingToOthers,      // matching proattivo (deterministico)
  retractListingFromOthers,      // ritiro dal "Per te" altrui (pausa/eliminazione)
  // se già le usi per pairwise:
  // recomputeMatchesForListing,
  // listMatchesForListing,
} from "../models/matches.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const matchesRouter = express.Router();

// Ping veloce per capire se il router è montato
matchesRouter.get("/snapshot/ping", (req, res) => {
  res.json({ ok: true });
});

/**
 * GET /api/matches/snapshot?userId=...
 * Risponde: { items, count, generatedAt }
 */
matchesRouter.get("/snapshot", requireAuth, async (req, res) => {
  try {
    const userId = String(req.query?.userId || "");
    if (!isUUID(userId)) return res.status(400).json({ error: "Invalid userId" });
    if (userId !== req.user.id) return res.status(403).json({ error: "Forbidden" });
    const out = await getUserSnapshot(userId);
    return res.json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * POST /api/matches/snapshot/recompute
 * Body: { userId, topPerListing?, maxTotal? }
 * Risponde: { userId, generatedAt, count }
 */

matchesRouter.post("/snapshot/recompute", requireAuth, async (req, res) => {
  try {
    const userId = String(req.body?.userId || "");
    const topPerListing = req.body?.topPerListing ?? 3;
    const maxTotal = req.body?.maxTotal ?? 50;
    if (!isUUID(userId)) return res.status(400).json({ error: "Invalid userId" });
    if (userId !== req.user.id) return res.status(403).json({ error: "Forbidden" });

    const out = await recomputeUserSnapshot(userId, { topPerListing, maxTotal });

    return res.status(201).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});
/**
 * POST /api/matches/propagate  Body: { listingId }
 * Matching proattivo: dopo aver pubblicato/modificato un MIO annuncio,
 * aggiorna (deterministicamente, senza costo AI) il "Per te" degli altri
 * utenti per cui questo annuncio è un buon match. Fire-and-forget dal client.
 */
matchesRouter.post("/propagate", requireAuth, async (req, res) => {
  try {
    const listingId = String(req.body?.listingId || "");
    if (!isUUID(listingId)) return res.status(400).json({ error: "Invalid listingId" });
    // requireOwner: solo il proprietario dell'annuncio può innescare la propagazione.
    const out = await propagateListingToOthers(listingId, { requireOwner: req.user.id });
    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error('[matches/propagate] error:', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * POST /api/matches/retract  Body: { listingId }
 * Simmetrico a /propagate: dopo aver messo in pausa/eliminato un MIO
 * annuncio, lo ritira dal "Per te" di chi lo aveva suggerito (invece di
 * lasciarlo lì finché quella persona non ricalcola per conto proprio).
 * Fire-and-forget dal client.
 */
matchesRouter.post("/retract", requireAuth, async (req, res) => {
  try {
    const listingId = String(req.body?.listingId || "");
    if (!isUUID(listingId)) return res.status(400).json({ error: "Invalid listingId" });
    const out = await retractListingFromOthers(listingId, { requireOwner: req.user.id });
    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error('[matches/retract] error:', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

matchesRouter.post("/ai/recompute", requireAuth, async (req, res) => {
  try {
    const { userId, topPerListing = 3, maxTotal = 50 } = req.body || {};
    if (!userId || !isUUID(userId)) {
      return res.status(400).json({ ok: false, error: "missing/invalid userId" });
    }
    if (userId !== req.user.id) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    // 1) calcolo AI
    const ai = await recomputeMatches(userId); // { userId, generatedAt, items }
    // 2) aggiorna snapshot utente
    await recomputeUserSnapshot(userId, { topPerListing, maxTotal });
    // 3) prendi lo snapshot aggiornato e restituiscilo
    const snap = await getUserSnapshot(userId); // { items, count, generatedAt }
    return res.status(200).json({
      ai: { count: ai.items?.length ?? 0, generatedAt: ai.generatedAt },
      snapshot: snap,
    });
  } catch (e) {
    console.error('[matches/ai/recompute] error:', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});