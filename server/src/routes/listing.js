import { Router } from 'express';
import { isUUID } from '../util/uuid.js';
import { createListing, getListingPublic, listActiveListings, updateListing } from '../models/listings.js';

export const listingsRouter = Router();

// Esempio: middleware auth che setta req.user.id
function requireAuth(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

listingsRouter.get('/', async (req, res) => {
  const { ownerId, limit } = req.query;
  const items = await listActiveListings({ ownerId, limit: Number(limit) || 50 });
  res.json({ items, count: items.length });
});

listingsRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUUID(id)) return res.status(400).json({ error: 'Invalid id' });
  const item = await getListingPublic(id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item); // niente PNR
});

listingsRouter.post('/', requireAuth, async (req, res) => {
  const listing = await createListing(req.user.id, req.body);
  res.status(201).json(listing); // niente PNR
});

listingsRouter.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!isUUID(id)) return res.status(400).json({ error: 'Invalid id' });
  const updated = await updateListing(req.user.id, id, req.body);
  res.json(updated); // niente PNR
});
