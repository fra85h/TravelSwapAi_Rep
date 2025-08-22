import express from "express";
import { isUUID } from "../util/uuid.js";
import {
  // usa la versione che hai implementato: SQL o JS
  recomputeUserSnapshotSQL,
  recomputeUserSnapshot,
  getUserSnapshot,
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
