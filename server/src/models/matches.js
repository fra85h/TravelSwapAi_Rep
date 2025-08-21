// server/src/models/matches.js
import { isUUID } from '../util/uuid.js';
import { getUserProfile, listActiveListings } from './listings.js';
import { scoreWithAI, heuristicScore } from '../ai/score.js';
import {
  fetchActiveListingsForMatching,
  insertMatchesSnapshot,
  getLatestMatches,
} from '../db.js';

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
