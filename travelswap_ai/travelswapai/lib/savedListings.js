// lib/savedListings.js — Preferiti/Wishlist (tabella saved_listings)
import { supabase } from "./supabase";

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Insieme dei listing_id salvati dall'utente corrente */
export async function getSavedIds() {
  const uid = await currentUserId();
  if (!uid) return new Set();
  const { data, error } = await supabase
    .from("saved_listings")
    .select("listing_id")
    .eq("user_id", uid);
  if (error) throw error;
  return new Set((data || []).map((r) => r.listing_id));
}

/** true se l'annuncio è tra i preferiti dell'utente */
export async function isSaved(listingId) {
  const uid = await currentUserId();
  if (!uid || !listingId) return false;
  const { data, error } = await supabase
    .from("saved_listings")
    .select("listing_id")
    .eq("user_id", uid)
    .eq("listing_id", listingId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Aggiunge ai preferiti (idempotente: evita duplicati anche senza vincolo unico) */
export async function saveListing(listingId) {
  const uid = await currentUserId();
  if (!uid) throw new Error("Non autenticato");
  if (await isSaved(listingId)) return;
  const { error } = await supabase
    .from("saved_listings")
    .insert({ user_id: uid, listing_id: listingId });
  if (error) throw error;
}

/** Rimuove dai preferiti */
export async function unsaveListing(listingId) {
  const uid = await currentUserId();
  if (!uid) throw new Error("Non autenticato");
  const { error } = await supabase
    .from("saved_listings")
    .delete()
    .eq("user_id", uid)
    .eq("listing_id", listingId);
  if (error) throw error;
}

/** Inverte lo stato; ritorna il nuovo stato (true = salvato) */
export async function toggleSaved(listingId, currentlySaved) {
  if (currentlySaved) {
    await unsaveListing(listingId);
    return false;
  }
  await saveListing(listingId);
  return true;
}

/** Annunci salvati con i dettagli pubblici (join su listings, niente PNR) */
export async function listSavedListings() {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("saved_listings")
    .select(
      "created_at, listing:listing_id ( id, title, type, location, price, currency, route_from, route_to, depart_at, arrive_at, check_in, check_out, image_url, status, cerco_vendo )"
    )
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  // scarta eventuali annunci cancellati (join nullo) e appiattisci
  return (data || []).map((r) => r.listing).filter(Boolean);
}
