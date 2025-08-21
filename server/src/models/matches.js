// server/src/matches.js
import { fetchActiveListingsForMatching, insertMatchesSnapshot, getLatestMatches } from '../db.js';
import { scoreWithAI } from '../services/ai.js';

export async function recomputeMatches(userId, { userProfile = null } = {}) {
  // 1) prendi i listing attivi
  const listings = await fetchActiveListingsForMatching();
  if (!listings.length) {
    // salva snapshot vuoto, così il client non resta appeso
    await insertMatchesSnapshot(userId, []);
    return { userId, generatedAt: new Date().toISOString(), matches: [] };
  }

  // 2) profilo utente (puoi arricchirlo da DB: preferenze, storico, budget…)
  const user = userProfile || {
    id: userId,
    bio: 'Preferenze non specificate',
    prefs: { types: ['hotel','train'], maxPrice: 200 }
  };

  // 3) chiedi ad OpenAI uno score
  const scored = await scoreWithAI(user, listings);

  // 4) fallback: se AI down, usa regole semplici
  const safeScores = (scored && scored.length)
    ? scored
    : listings.map(l => ({
        id: l.id,
        score: Math.max(60, 100 - Math.abs((l.price || 120) - 120)), // giocattolo: più vicino a 120 = punteggio alto
        bidirectional: false,
        reason: 'fallback'
      }));

  // 5) join con metadati per comodità client
  const metaById = new Map(listings.map(l => [l.id, l]));
  const items = safeScores
    .map(s => {
      const m = metaById.get(s.id);
      return {
        listing_id: s.id,
        score: Math.round(s.score),
        bidirectional: !!s.bidirectional,
        reason: s.reason || null,
        type: m?.type || null,
        title: m?.title || null,
        location: m?.location || null,
        price: m?.price ?? null,
      };
    })
    .sort((a,b) => b.score - a.score);

  // 6) salva snapshot
  const snapshot = await insertMatchesSnapshot(userId, items);

  return {
    userId,
    generatedAt: snapshot.generated_at,
    matches: snapshot.items,
  };
}

export async function listMatches(userId) {
  const latest = await getLatestMatches(userId);
  if (!latest) return { userId, generatedAt: null, matches: [] };
  return {
    userId: latest.user_id,
    generatedAt: latest.generated_at,
    matches: latest.items || [],
  };
}
