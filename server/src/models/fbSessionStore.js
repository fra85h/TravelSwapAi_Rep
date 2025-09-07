import { supabase } from '../db.js';

export async function getSession(senderId) {
  const { data, error } = await supabase
    .from('fb_sessions')
    .select('payload')
    .eq('sender_id', senderId)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // nessuna riga ≠ errore fatale
  return data?.payload || {};
}

export async function saveSession(senderId, payload) {
  const { error } = await supabase
    .from('fb_sessions')
    .upsert({ sender_id: senderId, payload }, { onConflict: 'sender_id' });
  if (error) throw error;
}

export async function clearSession(senderId) {
  await supabase.from('fb_sessions').delete().eq('sender_id', senderId);
}
