
// lib/offers_lists_rpc.js
// Liste "inbox" (ricevute) e "outbox" (inviate) via RPC tolleranti UUID/INT
import { supabase } from "./supabase";

function normalize(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    message: row.message,
    amount: row.amount,
    currency: row.currency,
    created_at: row.created_at,
    updated_at: row.updated_at,
    to_listing: { id: row.to_listing_id, title: row.to_listing_title },
    from_listing: row.from_listing_id
      ? { id: row.from_listing_id, title: row.from_listing_title }
      : null,
  };
}

export async function listIncomingOffersAny() {
  const { data, error } = await supabase.rpc("list_incoming_offers_any");
  if (error) throw new Error(error.message || "Impossibile caricare proposte ricevute");
  return (data || []).map(normalize);
}

export async function listOutgoingOffersAny() {
  const { data, error } = await supabase.rpc("list_outgoing_offers_any");
  if (error) throw new Error(error.message || "Impossibile caricare proposte inviate");
  return (data || []).map(normalize);
}
