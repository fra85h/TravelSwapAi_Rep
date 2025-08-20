// server/src/models/listings.js
import { supabase } from "../db.js";
import { isUUID } from "../util/uuid.js";

/**
 * Ritorna il profilo utente (preferenze ecc.)
 * Tabella esempio: profiles(id uuid PK, full_name, prefs jsonb, ...)
 */
export async function getUserProfile(userId) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, prefs")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Ritorna SOLO listing attivi, con UUID reali.
 * Esclude i listing dell’utente (ownerId) se passato.
 * Tabella esempio: listings(id uuid PK, user_id uuid, status text, type text, title, location, price, description)
 */
export async function listActiveListings({ ownerId = null, limit = 200 } = {}) {
  let q = supabase
    .from("listings")
    .select("id, user_id, status, type, title, location, price, description")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ownerId && isUUID(ownerId)) {
    q = q.neq("user_id", ownerId);
  }

  const { data, error } = await q;
  if (error) throw error;

  // filtra safety: solo UUID veri
  return (data || []).filter(r => isUUID(r.id));
}
