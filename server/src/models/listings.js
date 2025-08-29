// server/src/models/listings.js
import { supabase } from "../db.js";
import { isUUID } from "../util/uuid.js";

// Se hai uno schema privato in Supabase, puoi usare "private.listing_secrets"
const SECRETS_TABLE = "listing_secrets"; // oppure "private.listing_secrets"

function normCV(v){ return String(v||'VENDO').toUpperCase()==='CERCO' ? 'CERCO':'VENDO'; }

/**
 * Ritorna il profilo utente (preferenze ecc.)
 * Tabella: profiles(id uuid PK, full_name, prefs jsonb, ...)
 */
/*export async function getUserProfile(userId) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, prefs")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || { id: userId, prefs: {} };
}
*/
/**
 * Lista i listing attivi per il matching o per la lista pubblica.
 * Esclude quelli dell'owner se passato.
 */
export async function listActiveListings({ ownerId = null, limit = 100 } = {}) {
  if (!supabase) throw new Error("Supabase client not configured");
console.log("qui sono dentro listactivelistings");
  let q = supabase
    .from("listings")
    .select(
      // ⚠️ Non includere PNR: sta su tabella separata
      "id, user_id, title, description, type, location, price, status, created_at,cerco_vendo,route_from,route_to,depart_at,arrive_at"
    )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ownerId && isUUID(ownerId)) {
    // esclude i listing dell'utente (utile per matching)
    q = q.neq("user_id", ownerId);
  }

  const { data, error } = await q;
  if (error) throw error;

  // safety: solo record con id valido
  console.log("qui ho finito con listactivelistings");
  return (data || []).filter((r) => isUUID(r.id));
}

/**
 * Crea un listing: salva i campi pubblici nella tabella pubblica e il PNR in tabella privata.
 * NON ritorna mai il PNR.
 */
export async function createListing(userId, payload) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  if (!supabase) throw new Error("Supabase client not configured");

  const { pnr, ...pub } = payload || {};
  const insertPayload = {
    ...pub,
    cerco_vendo: normCV(pub.cerco_vendo),
    published_at: new Date().toISOString(),
    user_id: userId,
    status: pub.status || "active",
  };

  const { data: listing, error } = await supabase
    .from("listings")
    .insert(insertPayload)
    .select(
      "id, user_id, title, description, type, location, price, status, created_at"
    )
    .single();
  if (error) throw error;

  if (pnr) {
    const { error: err2 } = await supabase
      .from(SECRETS_TABLE)
      .insert({ listing_id: listing.id, pnr });
    if (err2) throw err2;
  }

  // NON includere PNR nella risposta
  return listing;
}

/**
 * Ritorna il dettaglio pubblico di un listing (senza PNR).
 */
export async function getListingPublic(id) {
  if (!isUUID(id)) throw new Error("Invalid id");
  if (!supabase) throw new Error("Supabase client not configured");

  const { data, error } = await supabase
    .from("listings")
    .select(
      "id, user_id, title, description, type, location, price, status, created_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Aggiorna un listing dell'owner. Se arriva pnr, lo salva/upserta nella tabella segreta.
 * NON ritorna mai il PNR.
 */
export async function updateListing(userId, id, patch) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  if (!isUUID(id)) throw new Error("Invalid id");
  if (!supabase) throw new Error("Supabase client not configured");

  const { pnr, ...pub } = patch || {};

  const { data: listing, error } = await supabase
    .from("listings")
    .update(pub)
    .eq("id", id)
    .eq("user_id", userId)
    .select(
      "id, user_id, title, description, type, location, price, status, created_at"
    )
    .single();
  if (error) throw error;

  if (pnr !== undefined) {
    const { error: err2 } = await supabase
      .from(SECRETS_TABLE)
      .upsert({ listing_id: id, pnr });
    if (err2) throw err2;
  }

  return listing;
}
