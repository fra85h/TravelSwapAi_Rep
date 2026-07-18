// lib/savedSearches.js — avvisi di ricerca (D3): CRUD + match trovati
import { supabase } from "./supabase";
import { parseLocalizedNumber } from "./number";

export async function listMySavedSearches() {
  const { data, error } = await supabase
    .from("saved_searches")
    .select("id, type, cerco_vendo, route_from, route_to, location, max_price, active, created_at")
    .order("created_at", { ascending: false });
  if (error) { console.log("[listMySavedSearches]", error.message); return []; }
  return data || [];
}

export async function createSavedSearch({ type, routeFrom, routeTo, location, maxPrice }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Utente non autenticato");

  const payload = {
    user_id: user.id,
    type,
    cerco_vendo: "VENDO",
    route_from: type === "hotel" ? null : (routeFrom || null),
    route_to: type === "hotel" ? null : (routeTo || null),
    location: type === "hotel" ? (location || null) : null,
    // parseLocalizedNumber gestisce sia "45" che "45,50" (virgola decimale
    // italiana): un semplice Number(maxPrice) tornava NaN per qualunque
    // prezzo con la virgola, mai gestita prima d'ora in questo punto.
    max_price: parseLocalizedNumber(maxPrice),
  };

  const { data, error } = await supabase
    .from("saved_searches")
    .insert(payload)
    .select("id, type, cerco_vendo, route_from, route_to, location, max_price, active, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function setSavedSearchActive(id, active) {
  const { error } = await supabase.from("saved_searches").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function deleteSavedSearch(id) {
  const { error } = await supabase.from("saved_searches").delete().eq("id", id);
  if (error) throw error;
}

/**
 * I match trovati per gli avvisi dell'utente corrente, con l'annuncio
 * già unito. Query in più passaggi (nessun join annidato PostgREST),
 * stesso approccio usato in lib/chains.js.
 */
export async function listMyMatches() {
  const { data: searches, error: e1 } = await supabase
    .from("saved_searches")
    .select("id, type, route_from, route_to, location, max_price");
  if (e1) { console.log("[listMyMatches]", e1.message); return []; }
  if (!searches || !searches.length) return [];

  const searchIds = searches.map((s) => s.id);
  const { data: matches, error: e2 } = await supabase
    .from("saved_search_matches")
    .select("id, saved_search_id, listing_id, matched_at, seen")
    .in("saved_search_id", searchIds)
    .order("matched_at", { ascending: false });
  if (e2) { console.log("[listMyMatches]", e2.message); return []; }
  if (!matches || !matches.length) return [];

  const listingIds = Array.from(new Set(matches.map((m) => m.listing_id)));
  const { data: listings, error: e3 } = await supabase
    .from("listings")
    .select("id, title, type, location, route_from, route_to, depart_at, check_in, price, image_url, status")
    .in("id", listingIds);
  if (e3) console.log("[listMyMatches]", e3.message);
  const listingsById = new Map((listings || []).map((l) => [l.id, l]));
  const searchesById = new Map(searches.map((s) => [s.id, s]));

  return matches
    .map((m) => ({
      ...m,
      listing: listingsById.get(m.listing_id) || null,
      search: searchesById.get(m.saved_search_id) || null,
    }))
    .filter((m) => m.listing && m.listing.status === "active");
}

export async function markMatchSeen(matchId) {
  const { error } = await supabase.from("saved_search_matches").update({ seen: true }).eq("id", matchId);
  if (error) throw error;
}
