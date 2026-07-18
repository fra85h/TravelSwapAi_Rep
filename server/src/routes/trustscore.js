// server/src/routes/trustscore.js
import express from 'express';
import { body, validationResult } from 'express-validator';
import { computeFullTrustScore } from '../services/trust/computeTrustScore.js';
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

    // Lingua richiesta dal client (it/en/es): l'AI risponde in questa lingua
    // e i fix euristici deterministici vengono localizzati di conseguenza.
    const locale = ['it', 'en', 'es'].includes(req.body?.locale) ? req.body.locale : 'it';

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
      const scored = await computeFullTrustScore(listing, locale);

      const response = {
        ...scored,
        metadata: {
          version: '1.1.0',
          listingId: listing.id ?? null,
          evaluatedAt: new Date().toISOString(),
        },
      };
      delete response.moderationFlagged; // dettaglio interno, non nel contratto di risposta HTTP
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