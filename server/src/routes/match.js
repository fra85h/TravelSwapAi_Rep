import express from "express";
import { isUUID } from "../util/uuid.js";
import {
  // usa la versione che hai implementato: SQL o JS
  recomputeUserSnapshotSQL,
  recomputeUserSnapshot,
  getUserSnapshot,
  recomputeMatches,              // ⬅️ AGGIUNTO
  // se già le usi per pairwise:
  // recomputeMatchesForListing,
  // listMatchesForListing,
} from "../models/matches.js";

export const matchesRouter = express.Router();

// Ping veloce per capire se il router è montato
matchesRouter.get("/snapshot/ping", (req, res) => {
  res.json({ ok: true });
});

/**
 * GET /api/matches/snapshot?userId=...
 * Risponde: { items, count, generatedAt }
 */
matchesRouter.get("/snapshot", async (req, res) => {
  try {
    const userId = String(req.query?.userId || "");
    if (!isUUID(userId)) return res.status(400).json({ error: "Invalid userId" });
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
matchesRouter.post("/snapshot/recompute", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "");
    const topPerListing = req.body?.topPerListing ?? 3;
    const maxTotal = req.body?.maxTotal ?? 50;
    if (!isUUID(userId)) return res.status(400).json({ error: "Invalid userId" });

    // Se hai creato l’RPC v2, preferisci la SQL:
    // const out = await recomputeUserSnapshotSQL(userId, { topPerListing, maxTotal });
    const out = await recomputeUserSnapshot(userId, { topPerListing, maxTotal });

    return res.status(201).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});
matchesRouter.post("/ai/recompute", async (req, res) => {
  try {
     console.log("qui sono dentro routsmatches ai/recompute");
    const userId = String(req.body?.userId || "");
      console.log("qui ho costruito userId");
    const topPerListing = req.body?.topPerListing ?? 3;
          console.log("qui ho costruito userItopPerListingd");
    const maxTotal = req.body?.maxTotal ?? 50;
              console.log("qui ho costruito maxTotal");
    console.log("ciao6");
    if (!isUUID(userId)) return res.status(400).json({ error: "Invalid userId" });

    // 1) calcolo AI
    const ai = await recomputeMatches(userId); // { userId, generatedAt, items }
console.log("QUi ho fatto la recompute match");
    // 2) aggiorna snapshot utente
    const _ = await recomputeUserSnapshot(userId, { topPerListing, maxTotal });
console.log("QUi ho fatto lo snapshot");
    // 3) prendi lo snapshot aggiornato e restituiscilo
    const snap = await getUserSnapshot(userId); // { items, count, generatedAt }
     console.log("QUi leggo snapshot");
    return res.status(201).json({
      ai: { count: ai.items?.length ?? 0, generatedAt: ai.generatedAt },
      snapshot: snap,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});