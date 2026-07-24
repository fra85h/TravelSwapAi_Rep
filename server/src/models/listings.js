// server/src/models/listings.js
import { supabase } from "../db.js";
import { isUUID } from "../util/uuid.js";

const SECRETS_TABLE = "listing_secrets"; // o "private.listing_secrets"
function normCV(v){ return String(v||'VENDO').toUpperCase()==='CERCO' ? 'CERCO':'VENDO'; }

// Mappa l'ordinamento richiesto dall'API sulla colonna/direzione Postgres.
// NULLS LAST su trust_score in ENTRAMBE le direzioni: un annuncio non ancora
// verificato non deve mai comparire in cima, nemmeno ordinando per
// affidabilità crescente (stesso comportamento dei vecchi comparatori JS, che
// usavano -1 e 9999 come sentinelle proprio per spingere i null in fondo).
const SORT_MAP = {
  trust_desc: { column: "trust_score", ascending: false, nullsFirst: false },
  trust_asc:  { column: "trust_score", ascending: true,  nullsFirst: false },
  price_asc:  { column: "price",       ascending: true,  nullsFirst: false },
  price_desc: { column: "price",       ascending: false, nullsFirst: false },
  date_asc:   { column: "created_at",  ascending: true,  nullsFirst: false },
  date_desc:  { column: "created_at",  ascending: false, nullsFirst: false },
};

/**
 * Lista annunci attivi con supporto:
 * - exclude ownerId
 * - filtro minTrust
 * - ordinamenti vari
 * - paginazione limit/offset
 *
 * Filtro e ordinamento sono eseguiti da Postgres, non in memoria: prima
 * venivano applicati DOPO il .range(), cioè solo alla pagina già estratta —
 * "ordina per prezzo" ordinava i 100 annunci più recenti, non il catalogo, e
 * minTrust poteva restituire meno risultati del richiesto lasciando fuori
 * annunci idonei più vecchi.
 *
 * L'affidabilità si legge da listings.trust_score (denormalizzata dal trigger
 * su trust_audit) invece che dalla view v_latest_trustscore, che fa un GROUP
 * BY sull'intera trust_audit a ogni chiamata del feed.
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

  const order = SORT_MAP[sort] || SORT_MAP.date_desc;

  let q = supabase
    .from("listings")
    .select("id, user_id, title, description, type, location, price, status, created_at, cerco_vendo, route_from, route_to, depart_at, arrive_at, check_in, check_out, image_url, published_at, accepts_swap, swap_wanted, trust_score")
    .eq("status", "active")
    .order(order.column, { ascending: order.ascending, nullsFirst: order.nullsFirst })
    // Secondo criterio stabile: senza, due righe con lo stesso valore di
    // ordinamento (stesso prezzo, stesso trust_score) possono cambiare
    // posizione tra una pagina e l'altra, facendo sparire o duplicare
    // annunci durante lo scorrimento.
    .order("id", { ascending: true })
    .range(offset, Math.max(offset, offset + limit - 1));

  if (ownerId && isUUID(ownerId)) q = q.neq("user_id", ownerId);
  // Un annuncio senza trust_score (mai verificato) viene escluso da qualunque
  // soglia positiva: in SQL `NULL >= n` non è vero, stesso esito del vecchio
  // `(l.trust_score ?? 0) >= minTrust` lato JS.
  if (minTrust && Number.isFinite(Number(minTrust))) q = q.gte("trust_score", Number(minTrust));

  const { data: listings, error } = await q;
  if (error) throw error;

  const merged = (listings || []).filter(l => isUUID(l.id));

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
    // scambio (B)
    accepts_swap,
    swap_wanted,
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
    // scambio (B): un VENDO può accettare scambio e dichiarare cosa cerca
    accepts_swap: !!accepts_swap,
    swap_wanted: swap_wanted ?? null,
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
        "accepts_swap",
        "swap_wanted",
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
        "accepts_swap",
        "swap_wanted",
      ].join(",")
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Colonne che il proprietario può modificare via PATCH. Senza whitelist,
// l'intero req.body finiva spalmato nell'UPDATE eseguito con la
// SUPABASE_SERVICE_ROLE_KEY (bypassa le RLS): un owner poteva sovrascrivere
// anche user_id (dirottando la proprietà dell'annuncio) o trust_score/
// ai_reliability* (falsificando il TrustScore, calcolato SOLO dalla
// pipeline server-side in routes/trustscore.js).
const PATCHABLE_FIELDS = [
  "title", "description", "type", "location", "price", "status", "image_url",
  "route_from", "route_to", "depart_at", "arrive_at", "check_in", "check_out",
  "accepts_swap", "swap_wanted",
];

/**
 * Aggiorna un listing (owner-only). Se pnr è definito, upserta in tabella segreta.
 * NON ritorna mai il PNR.
 */
export async function updateListing(userId, id, patch) {
  if (!isUUID(userId)) throw new Error("Invalid userId");
  if (!isUUID(id)) throw new Error("Invalid id");
  if (!supabase) throw new Error("Supabase client not configured");

  const { pnr, cerco_vendo } = patch || {};

  const updatePayload = {};
  for (const field of PATCHABLE_FIELDS) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, field)) {
      updatePayload[field] = patch[field];
    }
  }
  if (cerco_vendo !== undefined) updatePayload.cerco_vendo = normCV(cerco_vendo);

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
        "accepts_swap",
        "swap_wanted",
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
