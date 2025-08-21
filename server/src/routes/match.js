// server/src/routes/matches.js
import { Router } from "express";
import { isUUID } from "../util/uuid.js";
import { recomputeMatches, listMatches } from "../models/matches.js";
import { getListingPublic } from "../models/listings.js";
import { recomputeUserSnapshot, getUserSnapshot } from '../models/matches.js';
export const matchesRouter = Router();

/**
 * POST /api/matches/recompute
 * Body: { userId: "<uuid>" }
 * Rigenera i match per l'utente e salva lo snapshot.
 */
matchesRouter.post("/recompute", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "");
    if (!isUUID(userId)) return res.status(400).json({ error: "Invalid userId" });

    const snapshot = await recomputeMatches(userId);
    return res.status(201).json(snapshot);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * GET /api/matches?userId=<uuid>
 * Ritorna lo snapshot più recente con i dettagli dei listing (pubblici, senza PNR).
 */
matchesRouter.get("/", async (req, res) => {
  try {
    const userId = String(req.query?.userId || "");
    if (!isUUID(userId)) return res.status(400).json({ error: "Invalid userId" });

    // Snapshot items: [{ listingId, score, bidirectional }]
    const items = await listMatches(userId);

    if (!Array.isArray(items) || items.length === 0) {
      return res.json({ items: [], count: 0 });
    }

    // Arricchisci con i dettagli del listing (pubblici)
    const enriched = [];
    for (const it of items) {
      if (!isUUID(it.listingId)) continue;
      try {
        const l = await getListingPublic(it.listingId);
        if (!l) continue;
        enriched.push({
          id: l.id,
          title: l.title,
          type: l.type,
          location: l.location,
          price: l.price,
          score: it.score,
          bidirectional: !!it.bidirectional,
        });
      } catch {
        // ignora listing non trovati o errori transitori
      }
    }

    // Ordina per score desc (deterministico su id a parità)
    enriched.sort(
      (a, b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id))
    );

    return res.json({ items: enriched, count: enriched.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});
matchesRouter.post('/snapshot/recompute', async (req, res) => {
  try {
    const userId = String(req.body?.userId || '');
    const topPerListing = req.body?.topPerListing ?? 3;
    const maxTotal = req.body?.maxTotal ?? 50;
    if (!isUUID(userId)) return res.status(400).json({ error: 'Invalid userId' });

    const out = await recomputeUserSnapshot(userId, { topPerListing, maxTotal });
    res.status(201).json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

matchesRouter.get('/snapshot', async (req, res) => {
  try {
    const userId = String(req.query?.userId || '');
    if (!isUUID(userId)) return res.status(400).json({ error: 'Invalid userId' });

    const out = await getUserSnapshot(userId);
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});