// server/src/models/matches.js
import { isUUID } from '../util/uuid.js';
import { scoreWithAI, heuristicScore, adjustedScore } from '../ai/score.js';
import {
  //fetchActiveListingsForMatching,
  //insertMatchesSnapshot,
  //getLatestMatches,
  getUserProfile,
  supabase
} from '../db.js';
import { listActiveListingsOfUser, listMatchesForFrom, getLatestUserSnapshot } from '../db.js';
import { listActiveListings } from './listings.js';
import { sendExpoPush } from '../lib/push.js';
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
  // 4) NB: la cancellazione dei match precedenti avviene più sotto, SOLO
  // dopo che il ricalcolo ha prodotto righe — cancellare qui lasciava la
  // tabella (e quindi lo snapshot) vuota se il percorso AI/insert falliva.
  const fromIds = fromListings.map((l) => l.id);

//  const rows = [];
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
    console.log("fromListings:", fromListings.length);
console.log("candidates:", useCands.length);

// Tetto ai candidati inviati all'AI PER annuncio-sorgente. Con centinaia di
// annunci, mandarli TUTTI in un unico prompt (per ogni sorgente) fa saltare il
// ricalcolo: timeout, memoria e soprattutto i token di OUTPUT (l'AI dovrebbe
// restituire una riga per candidato). Pre-filtriamo con l'euristica gratuita e
// mandiamo all'AI solo i più promettenti: il prompt resta piccolo e la qualità
// resta sui candidati che contano (lo snapshot prende comunque i top).
const AI_CANDIDATE_CAP = Number(process.env.MATCH_AI_CANDIDATE_CAP || 60);
function aiCandidatesFor(contextUser) {
  if (useCands.length <= AI_CANDIDATE_CAP) return useCands;
  const pre = heuristicScore(contextUser, useCands); // [{ id, score, ... }]
  const rank = new Map(pre.map((p) => [p.id, p.score]));
  return useCands
    .slice()
    .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0, AI_CANDIDATE_CAP);
}
   // sostituito il 20250804_2043 per un codice che parallelizza x4
async function runPool(tasks, limit = 4) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= tasks.length) break;
      try {
        const out = await tasks[idx]();
        if (Array.isArray(out) && out.length) results.push(...out);
      } catch (e) {
        console.error("[AI task] errore:", e?.message || e);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// prepara le task (una per ogni from-listing)
const tasks = fromListings.map((f) => async () => {
  const contextUser = { ...user, fromListing: f };
  // Solo i candidati più promettenti finiscono nel prompt AI (vedi sopra).
  const aiCands = aiCandidatesFor(contextUser);
  const ai = await scoreWithAI(contextUser, aiCands);
  console.log(`[from ${f.id}] ai:`, Array.isArray(ai) ? ai.length : ai, `su ${aiCands.length} candidati`);

  // Se l'AI non risponde (timeout/chiave mancante/schema invalido),
  // usa il fallback euristico deterministico invece di lasciare l'utente senza match
  const base = (Array.isArray(ai) && ai.length)
    ? ai
    : heuristicScore(contextUser, aiCands);

  // Modificatore deterministico budget + prossimità data (Fase 2): applicato
  // sopra al punteggio base (AI o euristico). Un VENDO dentro il budget del
  // CERCO e vicino come data mantiene il punteggio; fuori budget o lontano
  // come data lo abbassa. Preciso e testabile, indipendente dall'LLM.
  const candById = new Map(aiCands.map((c) => [c.id, c]));
  const scored = base
    .map(s => ({ ...s, score: adjustedScore(s.score, f, candById.get(s.id)) }))
    .sort((a,b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)));

  console.log(`[from ${f.id}] scored:`, scored.length);

  // mappa in rows per questa sorgente
  const nowLocal = now;
  return scored
    .filter(s => s?.id)
    .map(s => ({
      from_listing_id: f.id,
      to_listing_id: s.id,
      score: Number(s.score) || 0,
      bidirectional: !!s.bidirectional,
      model: s.model || process.env.MATCH_AI_MODEL || 'gpt-4o-mini',
      explanation: s.explanation || null,
      generated_at: nowLocal,
    }));
});

// esegui con concorrenza limitata (configurabile via env)
const CONCURRENCY = Number(process.env.MATCH_AI_CONCURRENCY || 4);
const rows = await runPool(tasks, CONCURRENCY);
if (rows.length) {
  // Ricalcolo riuscito: ORA è sicuro rimuovere i match precedenti delle
  // sorgenti (pulizia dei candidati non più attivi) prima di inserire.
  if (fromIds.length) {
    const { error: delErr } = await supabase
      .from('matches')
      .delete()
      .in('from_listing_id', fromIds);
    if (delErr) throw delErr; // richiede SERVICE_ROLE_KEY lato server se RLS attiva
  }

  const CHUNK = Number(process.env.MATCH_INSERT_CHUNK || 100);

  // mappa rapida per sicurezza (se vuoi recuperare l'owner dalla listing)
  const ownerByFromId = new Map(fromListings.map(l => [l.id, l.user_id || userId]));

  for (let i = 0; i < rows.length; i += CHUNK) {
    // normalizza: aggiungi user_id e usa created_at al posto di generated_at
    const slice = rows.slice(i, i + CHUNK).map(({ generated_at, bidirectional, model, explanation,...r }) => ({
      user_id: ownerByFromId.get(r.from_listing_id) ?? user.id, // ⬅️ OBBLIGATORIO
      from_listing_id: r.from_listing_id,
      to_listing_id: r.to_listing_id,
      score: r.score,
      bidirectional,
      model,
      explanation,
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
//nuova versione che non scrive se lo snpashot è identico all'ultimo
export async function recomputeUserSnapshot(userid, { topPerListing = 3, maxTotal = 50 } = {}) {
  if (!isUUID(userid)) throw new Error('Invalid userId');

  const myListings = await listActiveListingsOfUser(userid, { limit: 200 });

  let aggregated = [];
  for (const from of myListings) {
    const top = await listMatchesForFrom(from.id, { limit: topPerListing });
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


/**
 * Matching PROATTIVO (a costo zero-AI).
 *
 * Problema: recomputeMatches gira solo per CHI pubblica. Se un altro utente
 * pubblica l'annuncio perfetto per me, il mio "Per te" non se ne accorge
 * finché non ripubblico o premo Ricalcola. Qui, alla pubblicazione/modifica
 * di L, calcoliamo con la sola EURISTICA DETERMINISTICA (nessuna chiamata
 * OpenAI, quindi economico e scalabile) quanto L è un buon match per gli
 * annunci-sorgente di ALTRI utenti, aggiorniamo la tabella matches solo per
 * quelle coppie e rinfreschiamo il loro snapshot "Per te".
 *
 * Il punteggio AI resta quello "vero": quando l'altro utente ripubblica o
 * ricalcola, recomputeMatches sovrascrive queste righe con lo score AI. Qui
 * garantiamo solo che il nuovo annuncio EMERGA subito, senza attesa.
 */
export async function propagateListingToOthers(listingId, { requireOwner = null, threshold = 55, maxCandidates = 500, maxSnapshotRefresh = 100 } = {}) {
  if (!isUUID(listingId) || !supabase) return { affected: 0, rows: 0 };

  const { data: L, error } = await supabase
    .from('listings')
    .select('id, user_id, title, type, location, price, status, cerco_vendo, route_from, route_to, depart_at, arrive_at, check_in, check_out, accepts_swap, swap_wanted')
    .eq('id', listingId)
    .maybeSingle();
  if (error || !L || L.status !== 'active') return { affected: 0, rows: 0 };
  if (requireOwner && String(L.user_id) !== String(requireOwner)) return { affected: 0, rows: 0 };

  // candidati = annunci attivi di ALTRI utenti (le LORO sorgenti "from")
  const candidates = (await listActiveListings({ ownerId: L.user_id, limit: maxCandidates })) || [];
  if (!candidates.length) return { affected: 0, rows: 0 };

  const rows = [];
  const affectedUsers = new Set();
  for (const f of candidates) {
    const base = heuristicScore({ fromListing: f }, [L]);
    const b = Array.isArray(base) && base[0];
    if (!b) continue;
    const score = adjustedScore(b.score, f, L); // budget + prossimità data
    if (score < threshold) continue;
    rows.push({
      user_id: f.user_id,
      from_listing_id: f.id,
      to_listing_id: L.id,
      score,
      bidirectional: !!b.bidirectional,
      model: 'heuristic',
      explanation: b.explanation || null,
      created_at: new Date().toISOString(),
    });
    affectedUsers.add(f.user_id);
  }
  if (!rows.length) return { affected: 0, rows: 0 };

  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: upErr } = await supabase
      .from('matches')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'from_listing_id,to_listing_id', returning: 'minimal' });
    if (upErr) { console.error('[propagate upsert]', upErr.message); return { affected: 0, rows: 0 }; }
  }

  // Rinfresca il "Per te" degli utenti toccati (economico: rilegge matches).
  let refreshed = 0;
  for (const uid of affectedUsers) {
    if (refreshed >= maxSnapshotRefresh) break;
    try { await recomputeUserSnapshot(uid); refreshed++; } catch { /* best effort */ }
  }

  // Notifica in-app "nuovi annunci per te" agli utenti toccati. Deduplicata:
  // al massimo UNA non letta ogni 6h per utente, così pubblicazioni frequenti
  // di altri non si trasformano in una raffica di notifiche.
  try {
    const uids = [...affectedUsers];
    const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('notifications')
      .select('user_id')
      .eq('type', 'new_matches')
      .is('read_at', null)
      .gte('created_at', sixHoursAgo)
      .in('user_id', uids);
    const already = new Set((recent || []).map((r) => r.user_id));
    const toNotify = uids.filter((u) => !already.has(u));
    if (toNotify.length) {
      await supabase.from('notifications').insert(
        toNotify.map((u) => ({
          user_id: u,
          type: 'new_matches',
          title: 'Nuovi annunci per te',
          body: 'Un nuovo annuncio è comparso tra i suggerimenti «Per te».',
          data: {},
        }))
      );
      // Push nativo (dormiente finché non ci sono token registrati).
      sendExpoPush(toNotify, {
        title: 'Nuovi annunci per te',
        body: 'Guarda i suggerimenti «Per te».',
        data: { type: 'new_matches' },
      });
    }
  } catch (e) { console.error('[propagate notify]', e?.message || e); }

  return { affected: affectedUsers.size, rows: rows.length };
}

export async function getUserSnapshot(userid) {
  if (!isUUID(userid)) throw new Error('Invalid userId');
  const snap = await getLatestUserSnapshot(userid);
  return snap
    ? { items: snap.items || [], count: (snap.items || []).length, generatedAt: snap.generated_at }
    : { items: [], count: 0, generatedAt: null };
}