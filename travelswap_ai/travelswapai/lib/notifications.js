// lib/notifications.js — centro notifiche in-app. Legge/aggiorna la tabella
// public.notifications (RLS: ognuno vede solo le proprie) e si aggancia al
// Realtime di Supabase, così il campanellino e la lista si aggiornano da soli
// quando arriva una proposta, un esito o nuovi match — senza refresh manuale.
import { supabase } from "./supabase";

// Canale di eventi locale: chi segna "letto" da una schermata fuori dal
// provider (es. la lista notifiche nello Stack radice) ping-a il badge perché
// si ricalcoli subito, senza aspettare il giro Realtime.
const listeners = new Set();
export function notifyNotificationsChanged() {
  listeners.forEach((fn) => { try { fn(); } catch {} });
}
export function subscribeNotificationsChanged(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

// Elenco notifiche più recenti (default 50).
export async function listNotifications({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, body, data, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Conteggio non lette (per il pallino sul campanellino).
export async function countUnreadNotifications() {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw error;
  return count || 0;
}

// Segna letta una singola notifica.
export async function markNotificationRead(id) {
  if (!id) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) throw error;
  notifyNotificationsChanged();
}

// Segna lette tutte le non lette dell'utente.
export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw error;
  notifyNotificationsChanged();
}

// Realtime: richiama onChange a ogni insert/update sulle MIE notifiche.
// Ritorna la funzione di unsubscribe. I payload passano dalla RLS di SELECT.
export function subscribeNotifications(userId, onChange) {
  if (!userId) return () => {};
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      () => { try { onChange?.(); } catch {} }
    )
    .subscribe();
  return () => { try { supabase.removeChannel(channel); } catch {} };
}

export { currentUserId as _currentUserId };
