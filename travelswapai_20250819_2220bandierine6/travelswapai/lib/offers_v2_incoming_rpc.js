
// lib/offers_v2_incoming_rpc.js
// Sostituto di listIncomingOffers(): usa RPC che gestisce mismatch uuid/int
import { supabase } from "./supabase";

export async function listIncomingOffersAny() {
  const { data, error } = await supabase.rpc("list_incoming_offers_any");
  if (error) throw new Error(error.message || "Impossibile caricare le offerte");
  // normalizza per avere campi coerenti con la UI
  return (data || []).map((o) => ({
    id: o.id, // text
    type: o.type,
    status: o.status,
    message: o.message,
    amount: o.amount,
    currency: o.currency,
    created_at: o.created_at,
    updated_at: o.updated_at,
    to_listing: { id: o.to_listing_id, title: o.to_listing_title },
    from_listing: o.from_listing_id ? { id: o.from_listing_id, title: o.from_listing_title } : null,
  }));
}
