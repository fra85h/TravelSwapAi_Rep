// server/src/models/savedSearches.js
// Avvisi di ricerca (D3): confronta gli annunci attivi con i filtri
// salvati dagli utenti. A differenza dello swap a catena, qui il
// matching è un filtro esplicito e letterale (tipo, tratta/città,
// prezzo massimo) — non serve giudizio AI, la corrispondenza deve
// essere prevedibile per l'utente che ha scritto il filtro.
import { supabase } from "../db.js";
import { listActiveListings } from "./listings.js";

function normCity(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// Tollera varianti dello stesso nome città (es. "Roma" vs "Roma Termini")
// in entrambe le direzioni, senza richiedere una corrispondenza esatta
// della stringa. Un filtro vuoto/assente non restringe nulla.
function cityMatches(wanted, actual) {
  const w = normCity(wanted);
  if (!w) return true;
  const a = normCity(actual);
  if (!a) return false;
  return a === w || a.includes(w) || w.includes(a);
}

/**
 * Vero se `listing` soddisfa il filtro `search`. Pura e sincrona, per
 * essere testabile senza mock di rete/DB.
 */
export function matchesSearch(search, listing) {
  if (!search || !listing) return false;
  if (listing.status !== "active") return false;
  if (listing.type !== search.type) return false;
  if (listing.cerco_vendo !== (search.cerco_vendo || "VENDO")) return false;

  if (search.type === "hotel") {
    if (!cityMatches(search.location, listing.location)) return false;
  } else {
    if (!cityMatches(search.route_from, listing.route_from)) return false;
    if (!cityMatches(search.route_to, listing.route_to)) return false;
  }

  if (search.max_price != null && listing.price != null) {
    if (Number(listing.price) > Number(search.max_price)) return false;
  }

  return true;
}

/**
 * Entry point: confronta tutti gli avvisi attivi con tutti gli annunci
 * attivi e registra i nuovi match trovati (idempotente: il vincolo
 * unique su saved_search_matches evita duplicati tra un run e l'altro).
 */
export async function findAndNotifyMatches() {
  if (!supabase) throw new Error("Supabase client not configured");

  const { data: searches, error: searchErr } = await supabase
    .from("saved_searches")
    .select("id, user_id, type, cerco_vendo, route_from, route_to, location, max_price")
    .eq("active", true);
  if (searchErr) throw searchErr;

  if (!searches || !searches.length) {
    return { activeSearches: 0, scannedListings: 0, newMatches: 0, errors: [] };
  }

  const allActive = await listActiveListings({ limit: 1000 });

  const newRows = [];
  for (const search of searches) {
    for (const listing of allActive) {
      if (listing.user_id === search.user_id) continue; // non avvisare del proprio annuncio
      if (matchesSearch(search, listing)) {
        newRows.push({ saved_search_id: search.id, listing_id: listing.id });
      }
    }
  }

  const errors = [];
  let newMatches = 0;
  const CHUNK = 200;
  for (let i = 0; i < newRows.length; i += CHUNK) {
    const slice = newRows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("saved_search_matches")
      .upsert(slice, { onConflict: "saved_search_id,listing_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      errors.push(error.message);
      continue;
    }
    newMatches += data?.length ?? 0;
  }

  return {
    activeSearches: searches.length,
    scannedListings: allActive.length,
    newMatches,
    errors,
  };
}
