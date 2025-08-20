import { Router } from 'express';
import { scoreListings } from '../services/ai.js';

const router = Router();

/**
 * POST /api/match
 * Body:
 * {
 *   "user": {
 *     "id": "u123",
 *     "prefs": {
 *        "types": ["hotel","train"],
 *        "location": "Milano",
 *        "maxPrice": 200
 *     },
 *     "bio": "Viaggio spesso nel weekend, amo centri città..."
 *   },
 *   "listings": [
 *      { "id":"l1", "title":"Frecciarossa Milano → Roma", "type":"train", "location":"Milano → Roma", "price":79, "description":"..." },
 *      { "id":"l2", "title":"B&B Duomo", "type":"hotel", "location":"Milano, Duomo", "price":140, "description":"..." }
 *   ]
 * }
 */
router.post('/', async (req, res, next) => {
  try {
    const { user, listings } = req.body || {};
    if (!user || !Array.isArray(listings)) {
      return res.status(400).json({ error: { message: 'Missing user or listings' } });
    }

    const results = await scoreListings(user, listings);

    // Output schema atteso dalla tua UI
    // aggiungo anche un campo "bidirectional" finto (puoi calcolarlo server-side se hai dati reciproci)
    const payload = results.map(r => ({
      id: r.id,
      title: r.title,
      location: r.location,
      type: r.type,
      score: Math.round(r.score),
      bidirectional: r.bidirectional ?? (r.score >= 80)
    }));

    res.json({ matches: payload });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/match/recompute
 * (opzionale) endpoint per forzare un ricalcolo lato server
 * puoi usare job queue, ecc. Qui mock.
 */
router.post('/recompute', async (_req, res) => {
  // fai partire un job async... qui mock:
  await new Promise(r => setTimeout(r, 250));
  res.json({ ok: true });
});

export default router;
