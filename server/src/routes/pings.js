// server/src/routes/pings.js
import express from 'express';
import { isUUID } from '../util/uuid.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimitPings } from '../middleware/rateLimit.js';
import { sendListingPing } from '../models/pings.js';

export const pingsRouter = express.Router();

/**
 * POST /api/pings  Body: { fromListingId, toListingId }
 * Segnala un proprio VENDO al proprietario di un CERCO (feature "Ping"):
 * niente offerta né chat, solo una notifica con link diretto all'annuncio.
 */
pingsRouter.post('/', requireAuth, rateLimitPings, async (req, res) => {
  try {
    const fromListingId = String(req.body?.fromListingId || '');
    const toListingId = String(req.body?.toListingId || '');
    if (!isUUID(fromListingId) || !isUUID(toListingId)) {
      return res.status(400).json({ error: 'Invalid listing id' });
    }
    const out = await sendListingPing(fromListingId, toListingId, req.user.id);
    return res.json(out);
  } catch (e) {
    console.error('[pings] error:', e);
    return res.status(400).json({ error: String(e?.message || e) });
  }
});
