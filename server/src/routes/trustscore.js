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
  '/ai/trustscore',
  requireAuth, // ← assicurati che imposti req.user.id
  rateLimitTrustScore,   // ⬅️ qui
  body('listing').isObject(),
  body('listing.description').isString().isLength({ min: 10 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array() });

    const { listing } = req.body;
    try {
      // 1) Heuristics locali (veloci, economiche)
      const heur = computeHeuristicChecks(listing);

      // 2) Verifica AI (multimodale: testo + immagini opzionali)
      const ai = await aiTrustReview(listing, heur);

      // 3) Fusione punteggio
      // pesi regolabili: più alto = più impatto
      const weights = { heuristics: 0.45, aiText: 0.45, aiImages: 0.10 };
      const trustScore = Math.round(
        (heur.score * weights.heuristics) +
        (ai.textScore * weights.aiText) +
        (ai.imageScore * weights.aiImages)
      );

      const response = {
        trustScore,
        subScores: {
          heuristics: heur.score,
          aiText: ai.textScore,
          aiImages: ai.imageScore,
          consistency: heur.consistencyScore,
          plausibility: heur.plausibilityScore,
          completeness: heur.completenessScore
        },
        flags: [...heur.flags, ...ai.flags],
        suggestedFixes: [...heur.suggestedFixes, ...ai.suggestedFixes],
        metadata: {
          version: '1.0.0',
          listingId: listing.id ?? null,
          evaluatedAt: new Date().toISOString()
        }
      };

      // 4) Salvataggio in Supabase (audit & analytics)
      await saveTrustAudit({
        userId: req.user.id,
        listingId: listing.id ?? null,
        payload: response
      });

      res.json(response);
    } catch (e) {
      console.error('[trustscore] error:', e);
      res.status(500).json({ error: 'TrustScore computation failed' });
    }
  }
);
