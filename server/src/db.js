// server/src/db.js
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
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
