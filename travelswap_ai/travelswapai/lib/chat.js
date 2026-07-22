// lib/chat.js — chat tra le due parti di una proposta ACCETTATA.
// La chat "è" l'offerta accettata (chat_id = offers.id): niente entità
// separata. Esiste solo post-accettazione (RLS lato DB lo garantisce anche
// contro client alterati); resta aperta a scambio concluso.
import { supabase } from "./supabase";

/** Le mie chat (offerte accettate/finalizzate), con ultimo messaggio e non letti. */
export async function listMyChats() {
  const { data, error } = await supabase.rpc("list_my_chats");
  if (error) throw new Error(error.message || "Impossibile caricare le chat");
  return (data || []).map((r) => ({
    offerId: r.offer_id,
    type: r.type,
    status: r.status,
    toListingId: r.to_listing_id,
    toListingTitle: r.to_listing_title,
    fromListingTitle: r.from_listing_title,
    lastBody: r.last_body,
    lastAt: r.last_at,
    unreadCount: Number(r.unread_count) || 0,
    updatedAt: r.updated_at,
    iConfirmed: !!r.i_confirmed,
    otherConfirmed: !!r.other_confirmed,
    disputed: !!r.disputed,
  }));
}

/** Stato conferma scambio di un'offerta (per la ChatScreen). */
export async function getOfferHandshake(offerId) {
  const { data, error } = await supabase.rpc("get_offer_handshake", { offer_id_text: String(offerId) });
  if (error) throw new Error(error.message || "Impossibile leggere lo stato dello scambio");
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  return {
    status: r.status,
    type: r.type,
    amount: r.amount,
    currency: r.currency,
    iConfirmed: !!r.i_confirmed,
    otherConfirmed: !!r.other_confirmed,
    reservationExpiresAt: r.reservation_expires_at,
    disputed: !!r.disputed,
    disputeReason: r.dispute_reason || null,
    needsNameChange: !!r.needs_name_change,
    ticketOperator: r.ticket_operator || null,
  };
}

/** Messaggi di una chat, dal più vecchio al più recente. */
export async function listChatMessages(offerId) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, offer_id, sender_id, body, created_at, read_at")
    .eq("offer_id", offerId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message || "Impossibile caricare i messaggi");
  return data || [];
}

/** Invia un messaggio nella chat di un'offerta accettata (RLS fa da guardia). */
export async function sendChatMessage(offerId, body) {
  const text = String(body || "").trim();
  if (!text) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non autenticato");
  const { data, error } = await supabase
    .from("chat_messages")
    .insert([{ offer_id: offerId, sender_id: user.id, body: text.slice(0, 2000) }])
    .select()
    .single();
  if (error) throw new Error(error.message || "Impossibile inviare il messaggio");
  return data;
}

/** Segna come letti i messaggi dell'altra parte. Best effort. */
export async function markChatRead(offerId) {
  try { await supabase.rpc("mark_chat_read", { offer_id_text: String(offerId) }); } catch {}
}

/**
 * Sottoscrizione realtime ai nuovi messaggi di una chat. Ritorna la funzione
 * di unsubscribe. I payload passano comunque dalla RLS di SELECT.
 */
export function subscribeToChat(offerId, onMessage) {
  const channel = supabase
    .channel(`chat:${offerId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: `offer_id=eq.${offerId}` },
      (payload) => { try { onMessage?.(payload?.new); } catch {} }
    )
    .subscribe();
  return () => { try { supabase.removeChannel(channel); } catch {} };
}
