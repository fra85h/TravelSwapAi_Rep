import { Router } from 'express';
import { isUUID } from '../util/uuid.js';
import { createListing, getListingPublic, listActiveListings, updateListing } from '../models/listings.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const listingsRouter = Router();

// Un'eccezione non catturata qui risaliva all'handler di default di Express,
// che senza NODE_ENV=production risponde al client con lo STACK TRACE
// completo: percorsi del filesystem, nomi dei moduli, struttura interna. Il
// dettaglio va nei log del server, al client solo un messaggio generico.
function fail(res, e, where) {
  console.error(`[listings/${where}]`, e);
  return res.status(500).json({ error: 'Errore interno' });
}

listingsRouter.get('/', async (req, res) => {
  try {
    const { ownerId, limit } = req.query;
    const items = await listActiveListings({ ownerId, limit: Number(limit) || 50 });
    res.json({ items, count: items.length });
  } catch (e) { return fail(res, e, 'list'); }
});

listingsRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'Invalid id' });
    const item = await getListingPublic(id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item); // niente PNR
  } catch (e) { return fail(res, e, 'get'); }
});

listingsRouter.post('/', requireAuth, async (req, res) => {
  try {
    const listing = await createListing(req.user.id, req.body);
    res.status(201).json(listing); // niente PNR
  } catch (e) { return fail(res, e, 'create'); }
});

listingsRouter.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'Invalid id' });
    const updated = await updateListing(req.user.id, id, req.body);
    res.json(updated); // niente PNR
  } catch (e) { return fail(res, e, 'update'); }
});


listingsRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'Invalid id' });
    const updated = await updateListing(req.user.id, id, { status: 'expired' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e?.message || String(e) });
  }
});
