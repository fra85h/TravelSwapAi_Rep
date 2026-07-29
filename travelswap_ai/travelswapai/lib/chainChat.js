// lib/chainChat.js — chat tra i 3 partecipanti di uno swap a catena
// COMPLETATO. Stesso pattern di lib/chat.js, ma su chain_id invece di
// offer_id: uno swap a 3 non ha una riga in `offers`, quindi non può
// vivere nella stessa tabella (vedi migration 20260728120000_chain_chat).
// Esiste solo a catena 'completed' — RLS lato DB lo garantisce comunque.
import { supabase } from "./supabase";

/** Le mie chat di catena (swap a 3 completati), con ultimo messaggio e non letti. */
export async function listMyChainChats() {
  const { data, error } = await supabase.rpc("list_my_chain_chats");
  if (error) { console.log("[listMyChainChats]", error.message); throw new Error("Impossibile caricare le chat"); }
  return (data || []).map((r) => ({
    chainId: r.chain_id,
    completedAt: r.completed_at,
    myGiveTitle: r.my_give_title,
    myReceiveTitle: r.my_receive_title,
    lastBody: r.last_body,
    lastAt: r.last_at,
    unreadCount: Number(r.unread_count) || 0,
    updatedAt: r.updated_at,
  }));
}

/** Messaggi di una chat di catena, dal più vecchio al più recente. */
export async function listChainChatMessages(chainId) {
  const { data, error } = await supabase
    .from("chain_messages")
    .select("id, chain_id, sender_id, body, created_at, read_at")
    .eq("chain_id", chainId)
    .order("created_at", { ascending: true });
  if (error) { console.log("[listChainChatMessages]", error.message); throw new Error("Impossibile caricare i messaggi"); }
  return data || [];
}

/** Invia un messaggio nella chat di una catena completata (RLS fa da guardia). */
export async function sendChainChatMessage(chainId, body) {
  const text = String(body || "").trim();
  if (!text) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non autenticato");
  const { data, error } = await supabase
    .from("chain_messages")
    .insert([{ chain_id: chainId, sender_id: user.id, body: text.slice(0, 2000) }])
    .select()
    .single();
  if (error) { console.log("[sendChainChatMessage]", error.message); throw new Error("Impossibile inviare il messaggio"); }
  return data;
}

/** Segna come letti i messaggi degli altri partecipanti. Best effort. */
export async function markChainChatRead(chainId) {
  try { await supabase.rpc("mark_chain_chat_read", { p_chain_id: chainId }); } catch {}
}

/**
 * Sottoscrizione realtime ai nuovi messaggi di una chat di catena. Ritorna
 * la funzione di unsubscribe. I payload passano comunque dalla RLS di SELECT.
 */
export function subscribeToChainChat(chainId, onMessage) {
  const channel = supabase
    .channel(`chainchat:${chainId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chain_messages", filter: `chain_id=eq.${chainId}` },
      (payload) => { try { onMessage?.(payload?.new); } catch {} }
    )
    .subscribe();
  return () => { try { supabase.removeChannel(channel); } catch {} };
}
