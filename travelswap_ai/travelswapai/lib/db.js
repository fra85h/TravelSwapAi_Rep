// lib/db.js
import { supabase } from "./supabase";
const API_URL = "http://0.0.0.0:8080"; // oppure l’URL del tuo server

/** Utente corrente (o null) */
export async function getCurrentUser() {
  // 1) assicura la sessione (e refresh se scaduta)
  const { data: { session }, error: sErr } = await supabase.auth.getSession();
  if (sErr) throw sErr;
  if (!session) return null;

  // 2) prendi l'utente
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user ?? null;
}

/** Normalizza date "YYYY-MM-DD" → oppure null */
function normDate(v) {
  const s = (v ?? "").trim?.() ?? String(v ?? "");
  if (!s) return null;
  // Postgres accetta "YYYY-MM-DD" come date
  return s;
}
const g = globalThis;
g._mem = g._mem || { listings: {} }; // cache in memoria sicura

// normalizza sempre la chiave ID a stringa
const key = (id) => String(id);
/** Inserisci un annuncio (assegna user_id automaticamente) */
export async function insertListing(payload) {
  const me = await getCurrentUser();
  if (!me) throw new Error("Not authenticated");

  const body = {
    user_id: me.id,
    type: payload.type, // 'hotel' | 'train' | 'flight'
    title: payload.title,
    description: payload.description ?? null,
    location: payload.location ?? null,
    trustscore: payload.trustscore??null,
    // CERCO/VENDO flag
    cerco_vendo: (payload.cerco_vendo === "CERCO" ? "CERCO" : "VENDO"),

    // hotel
    check_in: payload.type === "hotel" ? normDate(payload.check_in) : null,
    check_out: payload.type === "hotel" ? normDate(payload.check_out) : null,

    // transport
    route_from: payload.type !== "hotel" ? (payload.route_from ?? null) : null,
    route_to: payload.type !== "hotel" ? (payload.route_to ?? null) : null,
    depart_at: payload.type !== "hotel" ? normDate(payload.depart_at) : null,

    price: payload.price ?? null,
    currency: payload.currency ?? "EUR",
    status: payload.status || "active", // listing_status
  };

  const { data, error } = await supabase
    .from("listings")
    .insert([body])
    .select()
    .single();
  if (error) throw error;
  return data;
}
export async function updateListing(id, patch) {
  const { data, error } = await supabase
    .from('listings')
    .update(patch)
    .eq('id', id)
    .select('*')       // <-- fa fare "return=representation"
    .maybeSingle();    // <-- non lancia se 0 righe

  if (error) {
    console.error('updateListing error:', error);
    return { error };
  }
  if (!data) {
    // 0 righe toccate: id sbagliato o RLS
    return { error: { message: 'No rows updated (check ID or RLS policy)' } };
  }
  return data;
}
/** Aggiorna un annuncio */
function sanitizeListingPatch(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v !== undefined) {
      // se vuoi, converti stringhe vuote in null per colonne nullable
      out[k] = v === "" ? null : v;
    }
  }
  return out;
}
export function __debug_all() {
  return Array.from(g._mem.values());
}



/** Cancella un mio annuncio */
export async function deleteMyListing(id) {
  const { error } = await supabase.from("listings").update({ status: "expired" }).eq("id", id);
  if (error) throw error;
}
export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data;
}
/** Lista annunci pubblici (status=active). Se loggato, esclude i miei */
export async function listPublicListings({ limit = 50, excludeMine = true } = {}) {
  const me = await getCurrentUser().catch(() => null);
  let q = supabase
    .from("listings")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (excludeMine && me?.id) q = q.neq("user_id", me.id);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Lista dei miei annunci */
export async function listMyListings({ status, limit = 100 } = {}) {
  const me = await getCurrentUser();
  if (!me) throw new Error("Not authenticated");
  let q = supabase
    .from("listings")
    .select("*")
    .eq("user_id", me.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getOfferById(id) {
  if (!id) throw new Error("Missing offer id");
  const { data, error } = await supabase
    .from("offers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message || "Impossibile caricare l'offerta");
  return data;
}
/** Dettaglio annuncio per id */
export async function getListingById(id) {
  if (!id) throw new Error("Missing listing id");
  const { data, error } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message || "Impossibile caricare l'annuncio");
  return data;
}

/** Crea un'offerta (from -> to) */
export async function createOffer(from_listing_id, to_listing_id, { message } = {}) {
  const { data, error } = await supabase
    .from("offers")
    .insert([{ from_listing_id, to_listing_id, status: "pending", message }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Offerte collegate a un annuncio (sia in entrata che in uscita) */
export async function listOffersForListing(listingId) {
  const { data, error } = await supabase
    .from("offers")
    .select("*")
    .or(`from_listing_id.eq.${listingId},to_listing_id.eq.${listingId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Aggiorna stato o altri campi di un'offerta */
export async function updateOffer(id, status) {
  if (!id) throw new Error("Missing offer id");
  const { data, error } = await supabase
    .from("offers")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message || "Impossibile aggiornare l'offerta");
  return data;
}

// Dettaglio annuncio pubblico (solo campi safe)
export async function getPublicListingById(id) {
  if (!id) throw new Error("Missing listing id");
  const { data, error } = await supabase
    .from("listings")
    .select(
      "id,title,type,location,route_from,route_to,check_in,check_out,depart_at,price,currency,status,created_at,user_id"
    )
    .eq("id", id)
    .eq("status", "active")
    .single();

  if (error) throw new Error(error.message || "Impossibile caricare l'annuncio");
  return data;
}