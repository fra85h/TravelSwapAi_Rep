// server/src/routes/trustscore.js
import express from 'express';
import { body, validationResult } from 'express-validator';
import { computeHeuristicChecks } from '../services/trust/heuristics.js';
import { aiTrustReview } from '../services/trust/aiTrust.js';
import { saveTrustAudit } from '../services/trust/store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimitTrustScore } from '../middleware/rateLimit.js';


export const trustscoreRouter = express.Router();

/**
 * POST /ai/trustscore
 * Body: {
 *   listing: {
 *     id, type, title, description, origin, destination,
 *     startDate, endDate, price, currency, holderName,
 *     provider, images: [ { url, width?, height? } ]
 *   }
 * }
 */
trustscoreRouter.post(
  '/trustscore',
  requireAuth, // ← assicurati che imposti req.user.id
  rateLimitTrustScore,   // ⬅️ qui
  body('listing').isObject(),
  body('listing.description').isString().isLength({ min: 10 }),
  async (req, res) => {
        const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array() });
    }

    // 🔧 Normalizza input (evita crash su campi opzionali)
    const inListing = req.body?.listing || {};
    const listing = {
      ...inListing,
      images: Array.isArray(inListing.images) ? inListing.images : [],
      title: inListing.title ?? null,
      type: inListing.type ?? null,
      origin: inListing.origin ?? null,
      destination: inListing.destination ?? null,
      location: inListing.location ?? null,
      startDate: inListing.startDate ?? null,
      endDate: inListing.endDate ?? null,
      price: inListing.price ?? null,
      currency: inListing.currency ?? 'EUR',
    };

    if (process.env.NODE_ENV !== 'production') {
      console.log('[trustscore] incoming listing =', JSON.stringify(listing));
    }

    try {
      // 1) Heuristics (isolato)
      let heur = { score: 0, flags: [], suggestedFixes: [], consistencyScore: 0, plausibilityScore: 0, completenessScore: 0 };
      try {
        heur = computeHeuristicChecks(listing) || heur;
      } catch (e) {
        console.error('[trustscore] heuristics failed:', e);
        heur.flags.push({ code: 'HEUR_ERROR', msg: 'Heuristics non disponibili' });
      }

      // 2) AI review (isolata, con fallback se manca chiave o modulo)
      let ai = { textScore: heur.score || 50, imageScore: 50, flags: [], suggestedFixes: [] };
      try {
        ai = (await aiTrustReview(listing, heur)) || ai;
      } catch (e) {
        console.error('[trustscore] aiTrustReview failed:', e?.message || e);
        ai.flags.push({ code: 'AI_ERROR', msg: 'AI non disponibile, uso fallback' });
      }

      // 3) Fusione punteggio
  const weights = { heuristics: 0.45, aiText: 0.45, aiImages: 0.10 };

const h = Number(heur?.score ?? 0);
const t = Number(ai?.textScore ?? (h || 0));
const i = Number(ai?.imageScore ?? 50);

const trustScore = Math.round(
  (h * weights.heuristics) +
  (t * weights.aiText) +
  (i * weights.aiImages)
);

const response = {
  trustScore,
  subScores: {
    heuristics: h,
    aiText: t,
    aiImages: i,
    consistency: Number(heur?.consistencyScore ?? 0),
    plausibility: Number(heur?.plausibilityScore ?? 0),
    completeness: Number(heur?.completenessScore ?? 0),
  },
  flags: [...(heur?.flags ?? []), ...(ai?.flags ?? [])],
  suggestedFixes: [...(heur?.suggestedFixes ?? []), ...(ai?.suggestedFixes ?? [])],
  metadata: {
    version: '1.0.0',
    listingId: listing.id ?? null,
    evaluatedAt: new Date().toISOString(),
  },
};
      // 4) Salvataggio audit (non deve mai rompere la risposta)
      try {
        const userId = req.user?.id ?? null;
        await saveTrustAudit({
          userId,
          listingId: listing.id ?? null,
          payload: response,
        });
      } catch (e) {
        console.error('[trustscore] saveTrustAudit failed:', e?.message || e);
      }

      return res.json(response);
    } catch (e) {
      console.error('[trustscore] fatal error:', e);
      return res.status(500).json({ error: 'TrustScore computation failed' });
    }
   }
 );