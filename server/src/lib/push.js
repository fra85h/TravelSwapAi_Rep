// server/src/lib/push.js — invio push NATIVO (Expo). È la predisposizione al
// push del telefono: finché nessun client registra un token in `push_tokens`
// (serve un dev build nativo dell'app), ogni chiamata è un no-op silenzioso.
// Nessuna dipendenza nativa: si parla direttamente con l'endpoint Expo via
// fetch, così il server resta leggero e questo modulo non rompe nulla oggi.
import { supabase } from '../db.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Token push validi per gli utenti dati ([] se tabella vuota o errore).
async function tokensForUsers(userIds) {
  if (!supabase || !userIds?.length) return [];
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds);
  if (error) return [];
  return (data || []).map((r) => r.token).filter(Boolean);
}

// Invia una notifica push agli utenti dati. No-op se non ci sono token.
// Best-effort: non lancia mai (il flusso chiamante non deve dipenderne).
export async function sendExpoPush(userIds, { title, body, data } = {}) {
  try {
    const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
    const tokens = await tokensForUsers(ids);
    if (!tokens.length) return { sent: 0 };
    const messages = tokens.map((to) => ({ to, title, body, data: data || {}, sound: 'default' }));
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    return { sent: res.ok ? tokens.length : 0 };
  } catch {
    return { sent: 0 };
  }
}
