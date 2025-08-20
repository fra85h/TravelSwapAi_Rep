// server/src/routes/matches.js
import { Router } from "express";
import { isUUID } from "../util/uuid.js";
import { getUserProfile, listActiveListings } from "../models/listings.js";
import { upsertMatches, listMatchesForUser } from "../models/matches.js";
import { scoreWithAI, heuristicScore } from "../ai/score.js";

export const matchesRouter = Router();

/**
 * GET /api/matches?userId=<uuid>
 * Ritorna i match (letti dalla tabella matches) + dati listing basilari per render lato app.
 */
matchesRouter.get("/", async (req, res) => {
  try {
    const userId = String(req.query.userId || "");
    if (!isUUID(userId)) return res.status(400).json({ error: "Invalid userId" });

    // leggi i match calcolati
    const rows = await listMatchesForUser(userId, { minScore: 0 });

    if (rows.length === 0) {
      return res.json({ items: [] });
    }

    // join manuale sui listings per info di rendering
    const listingIds = rows.map(r => r.listing_id);

    const listings = await listActiveListings({ ownerId: null, limit: 500 });
    const byId = new Map(listings.map(l => [l.id, l]));

    const items = rows
      .map(r => {
        const l = byId.get(r.listing_id);
        if (!l) return null;
        return {
          id: l.id,
          title: l.title,
          location: l.location,
          type: l.type,
          price: l.price,
          score: r.score,
          bidirectional: r.bidirectional,
        };
      })
      .filter(Boolean);

    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/matches/recompute
 * body: { userId: "<uuid>" }
 * 1) carica profilo utente + listings attivi
 * 2) scoratura AI (o fallback)
 * 3) upsert su matches
 * 4) ritorna items ordinati per score
 */
matchesRouter.post("/recompute", async (req, res) => {
  try {   
    const userId = String(req.body?.userId || "");
    if (!isUUID(userId)) return res.status(400).json({ error: "Invalid userId" });

    const user = await getUserProfile(userId);                   // { id, full_name, prefs }
    const listings = await listActiveListings({ ownerId: userId, limit: 300 }); // esclude i miei

    // NIENTE mock-id (p1, p2...), qui solo UUID veri
    const cleanListings = listings.filter(l => isUUID(l.id));

    // 1) prova AI
    let scored = await scoreWithAI(user, cleanListings);

    // 2) fallback
    if (!Array.isArray(scored) || scored.length === 0) {
      scored = heuristicScore(user, cleanListings);
    }

    // 3) persisti
    await upsertMatches(userId, scored);

    // 4) risposta arricchita (join per titolo ecc.)
    const byId = new Map(cleanListings.map(l => [l.id, l]));
    const items = scored
      .map(r => {
        const l = byId.get(r.id);
        if (!l) return null;
        return {
          id: l.id,
          title: l.title,
          location: l.location,
          type: l.type,
          price: l.price,
          score: r.score,
          bidirectional: !!r.bidirectional,
        };
      })
      .filter(Boolean)
      .sort((a,b) => b.score - a.score);

    res.json({ items, count: items.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});
