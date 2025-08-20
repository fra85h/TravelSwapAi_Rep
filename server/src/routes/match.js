import { Router } from "express";
import { scoreWithAI } from "../services/ai.js";
import { scoreHeuristic } from "../services/heuristic.js";

export const matchesRouter = Router();

/** Mock listings con UUID validi – sostituisci con il DB quando vuoi */
const SAMPLE_LISTINGS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Frecciarossa Milano → Roma",
    type: "train",
    location: "Milano → Roma",
    price: 79,
    description: "Posto a sedere, mattina",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    title: "B&B Duomo",
    type: "hotel",
    location: "Milano, Duomo",
    price: 160,
    description: "Doppia con colazione",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    title: "Regionale Verona → Venezia",
    type: "train",
    location: "Verona → Venezia",
    price: 12,
    description: "Treno regionale",
  },
];

// ---- helpers condivisi ----
function buildUser(userId) {
  return {
    id: userId || "demo-user",
    bio: "Viaggi nel weekend, centri città, budget medio.",
    prefs: { types: ["hotel", "train"], location: "Milano", maxPrice: 150 },
  };
}

async function loadListings(/* { fromDb, userId } */) {
  // TODO: carica dal DB reale; per ora mock
  return SAMPLE_LISTINGS;
}

async function computeMatches(user, listings) {
  // 1) prova AI
  const ai = await scoreWithAI(user, listings);
  const scores = ai ?? scoreHeuristic(user, listings);

  // 2) merge dettagli+score
  const byId = new Map(listings.map((l) => [l.id, l]));
  const out = scores
    .map((s) => {
      const base = byId.get(s.id);
      if (!base) return null;
      return {
        id: base.id,
        title: base.title,
        location: base.location,
        type: base.type,
        score: Math.round(Number(s.score) || 0),
        bidirectional: Boolean(s.bidirectional),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return out;
}

// ---- GET /api/matches ----
matchesRouter.get("/matches", async (req, res) => {
  try {
    const { userId } = req.query;
    const user = buildUser(userId);
    const listings = await loadListings();
    const result = await computeMatches(user, listings);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- POST /api/matches/recompute ----
matchesRouter.post("/matches/recompute", async (req, res) => {
  try {
    const { userId } = req.body || {};
    const user = buildUser(userId);
    const listings = await loadListings();
    const result = await computeMatches(user, listings);
    // In futuro potresti accodare un job e rispondere 202. Oggi rispondiamo 200 con i dati.
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
