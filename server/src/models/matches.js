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
// Normalizza gli item dello snapshot per un confronto deterministico
function normalizeSnapshotItems(items) {
  // Adatta le chiavi ai tuoi item snapshot: usa gli identificativi reali
  // Esempi comuni nel tuo progetto: toId / to_listing_id / listingId
  return (items || [])
    .map((it) => ({
      to: it.toId ?? it.to_listing_id ?? it.listingId ?? it.id,
      // arrotonda se vuoi evitare falsi positivi per rumore decimale
      score: typeof it.score === "number" ? Math.round(it.score * 1000) / 1000 : Number(it.score || 0),
    }))
    .filter((x) => x.to) // scarta item senza id
    .sort((a, b) => {
      if (a.to < b.to) return -1;
      if (a.to > b.to) return 1;
      return b.score - a.score;
    });
}

function snapshotsAreEqual(aItems, bItems) {
  const A = normalizeSnapshotItems(aItems);
  const B = normalizeSnapshotItems(bItems);
  return JSON.stringify(A) === JSON.stringify(B);
}

 export async function recomputeMatches(userId) {
   if (!isUUID(userId)) throw new Error('Invalid userId');


  const now = new Date().toISOString();


  // 1) profilo utente (per il prompt AI)
  const user = await getUserProfile(userId);
//console.log(userid);
console.log("user ricavato con getuserprofile");
console.log(user);
  // 2) le TUE listing attive (sorgenti del match)
  const fromListings =
    (await listActiveListingsOfUser(user.id, { limit: 200 })) || [];

  if (!fromListings.length) {
    // nessuna sorgente → niente da calcolare (e pulizia eventuale dei vecchi from di questo utente)
    // Se vuoi, elimina anche le vecchie righe per sicurezza:
    // await db`DELETE FROM matches WHERE from_listing_id = ANY(${db.array([])})`;
    return { user, generatedAt: now, items: [] };
  }

  // 3) candidati = listing attive di ALTRI utenti
  // se hai una fetchActiveListingsForMatching() che esclude già il proprietario, usala pure
  const allActive = (await listActiveListings({ limit: 500 })) || [];
  const candidates = allActive.filter((l) => l.user_id !== user.id);
  if (!candidates.length) {
    return { user, generatedAt: now, items: [] };
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
const DETERMINISTIC = process.env.MATCH_AI_DETERMINISTIC !== "false"; // default true
const TEMP = Number(process.env.MATCH_AI_TEMP ?? (DETERMINISTIC ? 0 : 0.3));
const TOP_P = 1;
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function getSeed(userId, mode = process.env.MATCH_AI_SEED_MODE ?? (DETERMINISTIC ? "user" : "none")) {
  if (mode === "user")  return hash32(userId);
  if (mode === "daily") return (hash32(userId) ^ Number(new Date().toISOString().slice(0,10).replace(/-/g,""))) >>> 0;
  return undefined; // nessun seed
}
const useCands = candidates
  .slice()
  .sort((a,b) => String(a.id).localeCompare(String(b.id)));
  
  // 5) per OGNI tua listing, calcola punteggi contro i candidati e crea righe pairwise
  for (const f of fromListings) {
    // passa al modello anche un minimo di contesto della listing sorgente
    const contextUser = { ...user, fromListing: f };

    console.log("qui LANCIO AI per user ");
     console.log(user);
    //const ai = await scoreWithAI(contextUser, candidates);
    const ai = await scoreWithAI(
  { ...user, fromListing: f },
  useCands,
  { temperature: TEMP, top_p: TOP_P, seed: getSeed(userId) } // se supportato
);
    console.log("qui FINISCE AI");
       
    //const scored = Array.isArray(ai) && ai.length ? ai : heuristicScore(contextUser, candidates);
const scored = (Array.isArray(ai) ? ai : [])
  .map(s => ({ ...s, score: Math.round(Number(s.score || 0) * 1000) / 1000 }))
  .sort((a,b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
    for (const s of scored) { 
           console.log(s.model);
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
      user_id: ownerByFromId.get(r.from_listing_id) ?? user.id, // ⬅️ OBBLIGATORIO
      from_listing_id: r.from_listing_id,
      to_listing_id: r.to_listing_id,
      score: r.score,
      model,
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

  return { user, generatedAt: now, items: rows };
 }



/**
 * Ritorna l’ultimo snapshot matches salvato per l’utente.
 */
export async function listMatches(userId) {
  if (!isUUID(userId)) throw new Error('Invalid userId');
  const snap = await getLatestMatches(userId);
  return snap?.items || [];
}
/*
export async function recomputeUserSnapshot(userid, { topPerListing = 3, maxTotal = 50 } = {}) {
  if (!isUUID(userid)) throw new Error('Invalid userId');
console.log("qui lancio listActiveListingsOfUser con user ");
console.log(userid);
  const myListings = await listActiveListingsOfUser(userid, { limit: 200 });
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

  await insertUserSnapshot(userid, items);
  return { userid, generatedAt: new Date().toISOString(), count: items.length };
}*/
//nuova versione che non scrive se lo snpashot è identico all'ultimo
export async function recomputeUserSnapshot(userid, { topPerListing = 3, maxTotal = 50 } = {}) {
  if (!isUUID(userid)) throw new Error('Invalid userId');

  console.log("qui lancio listActiveListingsOfUser con user ", userid);
  const myListings = await listActiveListingsOfUser(userid, { limit: 200 });

  console.log("qui costruisco let aggregated");
  let aggregated = [];
  for (const from of myListings) {
    console.log("qui lancio  listMatchesForFrom");
    const top = await listMatchesForFrom(from.id, { limit: topPerListing });
    console.log("qui ho terminato  listMatchesForFrom");
    aggregated = aggregated.concat(top);
  }

  // dedup per toId (come già facevi)
  const seen = new Set();
  const dedup = [];
  for (const it of aggregated) {
    const k = it.toId;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    dedup.push(it);
  }

  // ordina e taglia
  dedup.sort((a, b) => (b.score - a.score) || String(a.toId).localeCompare(String(b.toId)));
  const items = dedup.slice(0, maxTotal);

  const now = new Date().toISOString();

  // 1) prendi l’ultimo snapshot dell’utente (ordinato per generated_at DESC)
  const { data: last, error: lastErr } = await supabase
    .from('match_snapshots')
    .select('id, user_id, items, generated_at')
    .eq('user_id', userid)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastErr) throw lastErr;

  // 2) se identico: aggiorna SOLO la data (generated_at) e NON inserire righe nuove
  if (last && snapshotsAreEqual(items, last.items)) {
    const { error: updErr } = await supabase
      .from('match_snapshots')
      .update({ generated_at: now })
      .eq('id', last.id);

    if (updErr) throw updErr;

    return { userid, generatedAt: now, count: items.length, reused: true };
  }

  // 3) se diverso: inserisci nuova riga
  const { data: inserted, error: insErr } = await supabase
    .from('match_snapshots')
    .insert([{ user_id: userid, items, generated_at: now }])
    .select('id, generated_at')
    .single();

  if (insErr) throw insErr;

  return {
    userid,
    generatedAt: inserted?.generated_at ?? now,
    count: items.length,
    reused: false,
  };
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


export async function getUserSnapshot(userid) {
  if (!isUUID(userid)) throw new Error('Invalid userId');
  const snap = await getLatestUserSnapshot(userid);
  return snap
    ? { items: snap.items || [], count: (snap.items || []).length, generatedAt: snap.generated_at }
    : { items: [], count: 0, generatedAt: null };
}