// server/src/db.js
import { createClient } from '@supabase/supabase-js';
import { mapWithConcurrency } from './lib/concurrency.js';
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;

//const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

export const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

export async function fetchActiveListingsForMatching() {
  if (!supabase) return [];
  // Adatta nomi di tabella/campi ai tuoi
  const { data, error } = await supabase
    .from('listings')
    .select('id, title, type, location, price, description, status')
    .eq('status', 'active');

  if (error) throw error;
  // Solo UUID veri
  return (data || []).filter(x => typeof x.id === 'string' && x.id.length >= 32);
}

export async function insertMatchesSnapshot(userId, items) {
  if (!supabase) return null;
  const payload = {
    user_id: userId,
    items: items || [],
  };
  const { data, error } = await supabase
    .from('matches')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}
export async function getUserProfile(userId) {
  if (!userId) throw new Error('Missing userId');
console.log("qui inizio getuserprofile");
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name') // niente alias qui
    .eq('id', userId)
    .maybeSingle();  // al massimo una riga

  if (error) throw error;
  if (!data) return { id: userId }; // fallback minimale
console.log("qui ho finito con getuserprofile");
  return {
    id: data.id,
    name: data.full_name ?? null  // alias via mapping JS

  };
}
export async function getLatestMatches(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('matches')
    .select('id, user_id, generated_at, items')
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
export async function listActiveListingsOfUser(userId, { limit = 200 } = {}) {
  const { data, error } = await supabase
    .from('listings')
    .select('id, user_id, title, description, type, location, price, status, created_at, cerco_vendo, depart_at, arrive_at, route_from, route_to, check_in, check_out, accepts_swap, swap_wanted')
    .eq('status', 'active').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function insertUserSnapshot(userId, items) {
  const { error } = await supabase
    .from('match_snapshots')
    .insert({ user_id: userId, generated_at: new Date().toISOString(), items });
  if (error) throw error;
}

export async function getLatestUserSnapshot(userId) {
  const { data, error } = await supabase
    .from('match_snapshots')
    .select('id, user_id, generated_at, items')
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data; // { id, user_id, generated_at, items }
}

// Un filtro `.in()` con centinaia di id diventa una query string enorme che
// la connessione rifiuta prima ancora di arrivare a Supabase (stesso problema
// già documentato in models/listings.js): si va a lotti.
const IN_CHUNK = 200;

// Query `matches` in volo contemporaneamente in listMatchesForFromMany.
const MATCHES_QUERY_CONCURRENCY = Number(process.env.MATCHES_QUERY_CONCURRENCY ?? 4);

async function selectInChunks(table, columns, column, values, decorate = (q) => q) {
  const out = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const slice = values.slice(i, i + IN_CHUNK);
    const { data, error } = await decorate(
      supabase.from(table).select(columns).in(column, slice)
    );
    if (error) throw error;
    if (data?.length) out.push(...data);
  }
  return out;
}

/**
 * Versione aggregata di listMatchesForFrom per PIÙ annunci sorgente.
 *
 * Prima lo snapshot utente chiamava listMatchesForFrom in un ciclo, una volta
 * per ogni annuncio dell'utente, e ognuna faceva 2 query (matches + listings):
 * un N+1 che con 10 annunci attivi significava 20 round-trip solo per
 * ricostruire il "Per te" — moltiplicati poi per ogni utente toccato da
 * propagate/retract.
 *
 * Qui la lettura dei candidati resta una query per sorgente (serve una LIMIT
 * per gruppo, vedi sotto) ma sono lanciate in parallelo, mentre la lettura
 * degli annunci diventa UNA sola per l'intero lotto invece di una per
 * sorgente: da 2N round-trip sequenziali a N paralleli + 1.
 *
 * Il taglio "top N per sorgente" e lo scarto dei candidati non più attivi
 * avvengono nello stesso ordine di prima (prima il taglio, poi lo scarto),
 * così il risultato resta identico a quello della versione a ciclo.
 *
 * @returns {Promise<Map<string, object[]>>} fromListingId -> item[]
 */
export async function listMatchesForFromMany(fromIds, { limitPerFrom = 100 } = {}) {
  const ids = [...new Set((fromIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();

  // Il "top N" resta una LIMIT per singola sorgente, eseguita da Postgres.
  // Un'unica query con `.in(from_listing_id, ids)` sarebbe stata un round-trip
  // solo, ma PostgREST non sa applicare un limite PER GRUPPO: avrebbe dovuto
  // scaricare tutte le righe e tagliarle qui, e con un tetto max-rows lato
  // server (Supabase ne impone uno) le sorgenti in coda sarebbero rimaste
  // silenziosamente senza match. Meglio N query piccole e garantite, ma
  // lanciate in parallelo invece che in fila.
  const perFrom = await mapWithConcurrency(ids, MATCHES_QUERY_CONCURRENCY, async (fromId) => {
    const { data, error } = await supabase
      .from('matches')
      .select('to_listing_id, score, created_at, explanation, model, bidirectional')
      .eq('from_listing_id', fromId)
      // Ordine deterministico: `score DESC` da solo lascia l'ordine dei pari
      // merito a Postgres, e uno snapshot che cambia ordine senza che sia
      // cambiato nulla verrebbe riscritto a ogni ricalcolo
      // (recomputeUserSnapshot salta la scrittura solo se lo snapshot è
      // IDENTICO al precedente).
      .order('score', { ascending: false })
      .order('to_listing_id', { ascending: true })
      .limit(limitPerFrom);
    if (error) throw error;
    return data || [];
  });

  const byFrom = new Map();
  ids.forEach((fromId, i) => {
    const rows = perFrom[i];
    if (rows?.length) byFrom.set(fromId, rows);
  });
  if (!byFrom.size) return new Map();

  // La seconda query invece è una sola per TUTTE le sorgenti: prima era una
  // per sorgente (il vero N+1), e gli annunci candidati sono in gran parte
  // gli stessi tra una sorgente e l'altra.
  const toIds = [...new Set([...byFrom.values()].flat().map((r) => r.to_listing_id).filter(Boolean))];
  // status='active' filtrato in SQL: le righe non attive verrebbero comunque
  // scartate subito dopo (un annuncio in pausa/venduto non deve restare nel
  // "Per te" di chi lo aveva suggerito), tanto vale non trasferirle.
  const toListings = await selectInChunks(
    'listings',
    'id, title, type, location, price, status, created_at',
    'id',
    toIds,
    (q) => q.eq('status', 'active')
  );
  const byId = new Map(toListings.map((l) => [String(l.id), l]));

  const out = new Map();
  for (const [fromId, matches] of byFrom) {
    const items = [];
    for (const r of matches) {
      const l = byId.get(String(r.to_listing_id));
      if (!l) continue; // mancante o non più attivo
      items.push({
        fromListingId: fromId,
        toId: l.id,
        title: l.title,
        type: l.type,
        location: l.location,
        price: l.price,
        score: r.score,
        updatedAt: r.created_at,
        explanation: r.explanation || null,
        model: r.model || null,
        bidirectional: !!r.bidirectional,
      });
    }
    if (items.length) out.set(fromId, items);
  }
  return out;
}

/**
 * Variante a singola sorgente, costruita sopra quella aggregata: due
 * implementazioni separate della stessa regola (top N, scarto dei non
 * attivi) sono la premessa di una divergenza silenziosa quando se ne
 * corregge una sola.
 */
export async function listMatchesForFrom(fromId, { limit = 100 } = {}) {
  const byFrom = await listMatchesForFromMany([fromId], { limitPerFrom: limit });
  return byFrom.get(String(fromId)) || [];
}
