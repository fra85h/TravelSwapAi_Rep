// server/src/models/matches.js
import { isUUID } from '../util/uuid.js';
import { getUserProfile, listActiveListings } from './listings.js';
import { scoreWithAI, heuristicScore } from '../ai/score.js';
import {
  fetchActiveListingsForMatching,
  insertMatchesSnapshot,
  getLatestMatches,
  supabase
} from '../db.js';
import { listActiveListingsOfUser, listMatchesForFrom, insertUserSnapshot, getLatestUserSnapshot } from '../db.js';

/**
 * Rigenera i match per userId e salva uno snapshot in tabella `matches`.
 */
export async function recomputeMatches(userId) {
  if (!isUUID(userId)) throw new Error('Invalid userId');

  // 1) Profilo utente
  const user = await getUserProfile(userId);

  // 2) Listings attivi per matching (escludi quelli dell'utente)
  // Se esiste fetchActiveListingsForMatching(), usa quella; altrimenti fallback su listActiveListings()
  const listings =
    (typeof fetchActiveListingsForMatching === 'function'
      ? await fetchActiveListingsForMatching()
      : await listActiveListings({ ownerId: userId, limit: 200 })) || [];

  if (!listings.length) {
    const snapshot = { userId, generatedAt: new Date().toISOString(), items: [] };
    await insertMatchesSnapshot(userId, snapshot.items);
    return snapshot;
  }

  // 3) Scoring: prova AI, altrimenti euristica
  const ai = await scoreWithAI(user, listings);
  const scored = Array.isArray(ai) && ai.length ? ai : heuristicScore(user, listings);

  // 4) Normalizza + ordina
  const byId = new Map(scored.map((x) => [x.id, x]));
  const items = listings
    .map((l) => {
      const s = byId.get(l.id);
      if (!s) return null;
      return {
        listingId: l.id,
        score: Number(s.score) || 0,
        bidirectional: !!s.bidirectional,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  // 5) Salva snapshot
  await insertMatchesSnapshot(userId, items);

  // 6) Ritorna payload
  return {
    userId,
    generatedAt: new Date().toISOString(),
    items,
  };
}

/**
 * Ritorna l’ultimo snapshot matches salvato per l’utente.
 */
export async function listMatches(userId) {
  if (!isUUID(userId)) throw new Error('Invalid userId');
  const snap = await getLatestMatches(userId);
  return snap?.items || [];
}
export async function recomputeUserSnapshot(userId, { topPerListing = 3, maxTotal = 50 } = {}) {
  if (!isUUID(userId)) throw new Error('Invalid userId');

  const myListings = await listActiveListingsOfUser(userId, { limit: 200 });

  let aggregated = [];
  for (const from of myListings) {
    const top = await listMatchesForFrom(from.id, { limit: topPerListing });
    aggregated = aggregated.concat(top);
  }

  // dedup opzionale per toId
  const seen = new Set();
  const dedup = [];
  for (const it of aggregated) {
    const k = it.toId;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(it);
  }

  dedup.sort((a, b) => (b.score - a.score) || String(a.toId).localeCompare(String(b.toId)));
  const items = dedup.slice(0, maxTotal);

  await insertUserSnapshot(userId, items);
  return { userId, generatedAt: new Date().toISOString(), count: items.length };
}
export async function recomputeUserSnapshotSQL(
  userId,
  { topPerListing = 3, maxTotal = 50, dedupByToId = true } = {}
) {
  if (!isUUID(userId)) throw new Error('Invalid userId');

  const { data, error } = await supabase
    .rpc('fn_user_top_matches', { p_user_id: userId, p_top_per_listing: topPerListing });
  if (error) throw error;

  let rows = data || [];

  let items = rows.map(r => ({
    fromListingId: r.from_listing_id,
    toId: r.to_listing_id,
    score: r.score,
    bidirectional: r.score >= 80,
    title: r.title,
    type: r.type,
    location: r.location,
    price: r.price,
    explanation: r.explanation || null,                  // 👈 nuovo
    model: r.model || null,                              // 👈 nuovo
    updatedAt: r.updated_at || new Date().toISOString()  // 👈 nuovo
  }));

  if (dedupByToId) {
    const best = new Map();
    for (const it of items) {
      const prev = best.get(it.toId);
      if (!prev) { best.set(it.toId, it); continue; }
      const pick =
        (it.score > prev.score) ||
        (it.score === prev.score && it.explanation && !prev.explanation)
          ? it : prev;
      best.set(it.toId, pick);
    }
    items = Array.from(best.values());
  }

  items.sort((a, b) => (b.score - a.score) || String(a.toId).localeCompare(String(b.toId)));
  items = items.slice(0, maxTotal);

  await insertUserSnapshot(userId, items);
  return { userId, generatedAt: new Date().toISOString(), count: items.length };
}


export async function getUserSnapshot(userId) {
  if (!isUUID(userId)) throw new Error('Invalid userId');
  const snap = await getLatestUserSnapshot(userId);
  return snap
    ? { items: snap.items || [], count: (snap.items || []).length, generatedAt: snap.generated_at }
    : { items: [], count: 0, generatedAt: null };
}