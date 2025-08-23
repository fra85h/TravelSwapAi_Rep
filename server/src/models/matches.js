// server/src/models/matches.js
import { isUUID } from '../util/uuid.js';

import { scoreWithAI, heuristicScore } from '../ai/score.js';
import {
  fetchActiveListingsForMatching,
  insertMatchesSnapshot,
  getLatestMatches,
  getUserProfile,
  supabase
} from '../db.js';
import { listActiveListingsOfUser, listMatchesForFrom, insertUserSnapshot, getLatestUserSnapshot } from '../db.js';
import { listActiveListings } from './listings.js';
/**
 * Rigenera i match per userId e salva uno snapshot in tabella `matches`.
 */
 export async function recomputeMatches(userId) {
   if (!isUUID(userId)) throw new Error('Invalid userId');


  const now = new Date().toISOString();

  // 1) profilo utente (per il prompt AI)
  const user = await getUserProfile(userId);

  // 2) le TUE listing attive (sorgenti del match)
  const fromListings =
    (await listActiveListings({ ownerId: userId, limit: 200 })) || [];

  if (!fromListings.length) {
    // nessuna sorgente → niente da calcolare (e pulizia eventuale dei vecchi from di questo utente)
    // Se vuoi, elimina anche le vecchie righe per sicurezza:
    // await db`DELETE FROM matches WHERE from_listing_id = ANY(${db.array([])})`;
    return { userId, generatedAt: now, items: [] };
  }

  // 3) candidati = listing attive di ALTRI utenti
  // se hai una fetchActiveListingsForMatching() che esclude già il proprietario, usala pure
  const allActive = (await listActiveListings({ limit: 500 })) || [];
  const candidates = allActive.filter((l) => l.user_id !== userId);
  if (!candidates.length) {
    return { userId, generatedAt: now, items: [] };
  }
console.log("qui cancello i match precedenti");
  // 4) cancella i match precedenti per le tue sorgenti
  const fromIds = fromListings.map((l) => l.id);
if (fromIds.length) {
  const { error } = await supabase
    .from('matches')
    .delete()
    .in('from_listing_id', fromIds);   // DELETE WHERE from_listing_id IN (...)

  if (error) throw error; // richiede SERVICE_ROLE_KEY lato server se RLS attiva
}

  const rows = [];

  // 5) per OGNI tua listing, calcola punteggi contro i candidati e crea righe pairwise
  for (const f of fromListings) {
    // passa al modello anche un minimo di contesto della listing sorgente
    const contextUser = { ...user, fromListing: f };
    console.log("qui LANCIO AI");
    const ai = await scoreWithAI(contextUser, candidates);
    console.log("qui FINISCE AI");
    const scored = Array.isArray(ai) && ai.length ? ai : heuristicScore(contextUser, candidates);

    for (const s of scored) {
      if (!s?.id) continue; // serve l'id della listing candidata
      rows.push({
        from_listing_id: f.id,     // ⬅️ MAI NULL
        to_listing_id: s.id,
        score: Number(s.score) || 0,
        bidirectional: !!s.bidirectional,
        model: s.model || 'gpt-4.1-mini',
        explanation: s.explanation || null,
        generated_at: now,
      });
    }
  }

if (rows.length) {
  const CHUNK = Number(process.env.MATCH_INSERT_CHUNK || 100);

  // mappa rapida per sicurezza (se vuoi recuperare l'owner dalla listing)
  const ownerByFromId = new Map(fromListings.map(l => [l.id, l.user_id || userId]));

  for (let i = 0; i < rows.length; i += CHUNK) {
    // normalizza: aggiungi user_id e usa created_at al posto di generated_at
    const slice = rows.slice(i, i + CHUNK).map(({ generated_at, bidirectional, model, explanation, ...r }) => ({
      user_id: ownerByFromId.get(r.from_listing_id) ?? userId, // ⬅️ OBBLIGATORIO
      from_listing_id: r.from_listing_id,
      to_listing_id: r.to_listing_id,
      score: r.score,
      created_at: generated_at ?? new Date().toISOString(),    // se vuoi forzare il timestamp
    }));

    // Se hai un vincolo unico, usa onConflict adeguato:
    const { error, status } = await supabase
      .from('matches')
      .upsert(slice, {
        onConflict: 'from_listing_id,to_listing_id', // oppure 'user_id,from_listing_id,to_listing_id' se il tuo UNIQUE è così
        returning: 'minimal',
      });
      // In alternativa, se NON hai alcun UNIQUE: .insert(slice, { returning: 'minimal' })

    if (error) {
      console.error('[matches insert] failed', { status, error });
      throw new Error(`Supabase insert failed [${status}]: ${error.message}`);
    }
  }
}

  return { userId, generatedAt: now, items: rows };
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
console.log("qui costruisco let aggregated");
  let aggregated = [];
  for (const from of myListings) {
    console.log("qui lancio  listMatchesForFrom");
    const top = await listMatchesForFrom(from.id, { limit: topPerListing });
     console.log("qui ho terminato  listMatchesForFrom");
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