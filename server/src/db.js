// server/src/db.js
import { createClient } from '@supabase/supabase-js';
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
    .select('id, user_id, title, description, type, location, price, status, created_at,cerco_vendo,depart_at,arrive_at')
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

export async function listMatchesForFrom(fromId, { limit = 100 } = {}) {
  const { data: rows, error } = await supabase
    .from('matches')
   .select('to_listing_id, score, created_at, explanation, model') // 👈
    .eq('from_listing_id', fromId)
    .order('score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const items = rows || [];
  if (!items.length) return [];

  const toIds = Array.from(new Set(items.map(r => r.to_listing_id)));
  const { data: toListings, error: e2 } = await supabase
    .from('listings')
    .select('id, title, type, location, price, status, created_at')
    .in('id', toIds);
  if (e2) throw e2;
  const byId = new Map((toListings || []).map(l => [l.id, l]));

  return items.map(r => {
    const l = byId.get(r.to_listing_id);
    if (!l) return null;
    return {
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
    };
  }).filter(Boolean);
}