// server/src/models/listings.js
import { supabase } from "../db.js";
import { isUUID } from "../util/uuid.js";

const SECRETS_TABLE = "listing_secrets"; // o "private.listing_secrets"
function normCV(v){ return String(v||'VENDO').toUpperCase()==='CERCO' ? 'CERCO':'VENDO'; }

/**
 * Lista annunci attivi con supporto:
 * - exclude ownerId
 * - filtro minTrust (via join client-side su v_latest_trustscore)
 * - ordinamenti vari
 * - paginazione limit/offset
 *
 * @param {{ ownerId?:string|null, minTrust?:number, sort?:string, limit?:number, offset?:number }} opts
 */
export async function listActiveListings({
  ownerId = null,
  minTrust = 0,
  sort = "date_desc",
  limit = 100,
  offset = 0
} = {}) {
  if (!supabase) throw new Error("Supabase client not configured");

  // 1) Listings base (solo pubblici, senza PNR)
    let q = supabase
    .from("listings")
    .select("id, user_id, title, description, type, location, price, status, created_at, cerco_vendo, route_from, route_to, depart_at, arrive_at, check_in, check_out, image_url, published_at")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .range(offset, Math.max(offset, offset + limit - 1)); // ✅ solo range
  if (ownerId && isUUID(ownerId)) q = q.neq("user_id", ownerId);

  const { data: listings, error } = await q;
  if (error) throw error;

  const clean = (listings || []).filter(l => isUUID(l.id));

  // 2) Join con ultima valutazione TrustScore (view)
  const ids = clean.map(l => l.id);
  let byIdTrust = new Map();

  if (ids.length) {
    const { data: trusts, error: err2 } = await supabase
      .from("v_latest_trustscore")
      .select("listing_id, trust_score, evaluated_at")
      .in("listing_id", ids);

    if (err2) throw err2;
    byIdTrust = new Map((trusts || []).map(r => [String(r.listing_id), r]));
  }

  // 3) Merge + filtro minTrust
  let merged = clean.map(l => {
    const t = byIdTrust.get(String(l.id));
    return {
      ...l,
      trust_score: t?.trust_score ?? null,
      trust_evaluated_at: t?.evaluated_at ?? null,
    };
  });

  if (minTrust && Number.isFinite(minTrust)) {
    merged = merged.filter(l => (l.trust_score ?? 0) >= Number(minTrust));
  }

  // 4) Ordinamenti
  merged.sort((a, b) => {
    switch (sort) {
      case "trust_desc": return (b.trust_score ?? -1) - (a.trust_score ?? -1);
      case "trust_asc":  return (a.trust_score ??  9999) - (b.trust_score ?? 9999);
      case "price_asc":  return Number(a.price ?? 0) - Number(b.price ?? 0);
      case "price_desc": return Number(b.price ?? 0) - Number(a.price ?? 0);
      case "date_asc":   return new Date(a.created_at) - new Date(b.created_at);
      case "date_desc":
      default:           return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  return merged;
}

/**
 * Crea un listing: salva i campi pubblici e (se presente) il PNR nella tabella segreta.
 * NON ritorna mai il PNR.
 *
 * payload supporta:
 *  - comuni: { title, description, type, location, price, status, cerco_vendo, image_url }
 *  - train:  { route_from, route_to, depart_at, arrive_at }
 *  - hotel:  { check_in, check_out }
 *  - segreti: { pnr }
 */
export async function createListing(userId, payload) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  if (!supabase) throw new Error("Supabase client not configured");

  const {
    pnr,
    title,
    description,
    type,
    location,
    price,
    status,
    cerco_vendo,
    image_url,
    // train
    route_from,
    route_to,
    depart_at,
    arrive_at,
    // hotel
    check_in,
    check_out,
  } = payload || {};

  const insertPayload = {
    title: (title ?? "").trim(),
    description: description ?? null,
    type: (type ?? "").trim() || "hotel",
    location: (location ?? "").trim(),
    price: price ?? null,
    status: status || "active",
    cerco_vendo: normCV(cerco_vendo),
    image_url: image_url ?? null,
    // viaggio/hotel
    route_from: route_from ?? null,
    route_to: route_to ?? null,
    depart_at: depart_at ?? null,
    arrive_at: arrive_at ?? null,
    check_in: check_in ?? null,
    check_out: check_out ?? null,
    // meta
    published_at: new Date().toISOString(),
    user_id: userId,
  };

  const { data: listing, error } = await supabase
    .from("listings")
    .insert(insertPayload)
    .select(
      [
        "id",
        "user_id",
        "title",
        "description",
        "type",
        "location",
        "price",
        "status",
        "created_at",
        "cerco_vendo",
        "route_from",
        "route_to",
        "depart_at",
        "arrive_at",
        "check_in",
        "check_out",
        "image_url",
        "published_at",
      ].join(",")
    )
    .single();

  if (error) throw error;

  if (pnr) {
    const { error: err2 } = await supabase
      .from(SECRETS_TABLE)
      .insert({ listing_id: listing.id, pnr });
    if (err2) throw err2;
  }

  return listing; // senza PNR
}

/**
 * Dettaglio pubblico (senza PNR).
 */
export async function getListingPublic(id) {
  if (!isUUID(id)) throw new Error("Invalid id");
  if (!supabase) throw new Error("Supabase client not configured");

  const { data, error } = await supabase
    .from("listings")
    .select(
      [
        "id",
        "user_id",
        "title",
        "description",
        "type",
        "location",
        "price",
        "status",
        "created_at",
        "cerco_vendo",
        "route_from",
        "route_to",
        "depart_at",
        "arrive_at",
        "check_in",
        "check_out",
        "image_url",
        "published_at",
      ].join(",")
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Aggiorna un listing (owner-only). Se pnr è definito, upserta in tabella segreta.
 * NON ritorna mai il PNR.
 */
export async function updateListing(userId, id, patch) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  if (!isUUID(id)) throw new Error("Invalid id");
  if (!supabase) throw new Error("Supabase client not configured");

  const {
    pnr,
    cerco_vendo,
    ...pubPatch
  } = patch || {};

  const updatePayload = {
    ...pubPatch,
    ...(cerco_vendo !== undefined ? { cerco_vendo: normCV(cerco_vendo) } : {}),
  };

  const { data: listing, error } = await supabase
    .from("listings")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select(
      [
        "id",
        "user_id",
        "title",
        "description",
        "type",
        "location",
        "price",
        "status",
        "created_at",
        "cerco_vendo",
        "route_from",
        "route_to",
        "depart_at",
        "arrive_at",
        "check_in",
        "check_out",
        "image_url",
        "published_at",
      ].join(",")
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

/**
 * (Opzionale) Soft delete: imposta status="deleted"
 */
export async function softDeleteListing(userId, id) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  if (!isUUID(id)) throw new Error("Invalid id");
  const { error } = await supabase
    .from("listings")
    .update({ status: "deleted" })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return { ok: true };
}
