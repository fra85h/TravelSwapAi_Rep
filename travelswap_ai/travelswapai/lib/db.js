// lib/db.js
import { supabase } from "./supabase";

// Colonne "pubbliche" di listings: MAI includere pnr o altri dati riservati
// (i segreti vivono in listing_secrets, lato server)
const LISTING_PUBLIC_COLUMNS =
  "id, user_id, title, description, type, location, price, currency, status, created_at, " +
  "cerco_vendo, route_from, route_to, depart_at, arrive_at, check_in, check_out, operator, " +
  "image_url, published_at, trust_score, is_named_ticket, contact_url, accepts_swap, swap_wanted";

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
/**
 * Salva/aggiorna il PNR (dato riservato) in listing_secrets — mai in listings.
 * La policy RLS "own secrets" consente la scrittura solo all'owner del listing.
 * Non blocca il flusso principale in caso di errore.
 */
async function savePnrSecret(listingId, pnr) {
  try {
    const clean = pnr == null ? null : String(pnr).trim();
    if (!clean) {
      await supabase.from("listing_secrets").delete().eq("listing_id", listingId);
      return;
    }
    const { error } = await supabase
      .from("listing_secrets")
      .upsert({ listing_id: listingId, pnr: clean });
    if (error) console.log("[savePnrSecret] error:", error.message);
  } catch (e) {
    console.log("[savePnrSecret] exception:", e?.message || e);
  }
}

/** Legge il PNR del proprio annuncio (solo owner, via RLS). Ritorna stringa o null. */
export async function getListingSecret(listingId) {
  if (!listingId) return null;
  const { data, error } = await supabase
    .from("listing_secrets")
    .select("pnr")
    .eq("listing_id", listingId)
    .maybeSingle();
  if (error) { console.log("[getListingSecret] error:", error.message); return null; }
  return data?.pnr ?? null;
}

/**
 * Vero se il PNR risulta già in vendita in un altro annuncio "vivo" (di
 * chiunque). Difesa anti doppia vendita dello stesso biglietto. excludeId: il
 * proprio annuncio in modifica (non conta come duplicato di se stesso).
 * Best effort: in errore ritorna false (l'indice unico a DB resta backstop).
 */
export async function isPnrInUse(pnr, excludeId = null) {
  const clean = String(pnr || "").trim();
  if (!clean) return false;
  try {
    const { data, error } = await supabase.rpc("is_pnr_active", {
      pnr_text: clean,
      exclude_listing_id: excludeId != null ? String(excludeId) : null,
    });
    if (error) { console.log("[isPnrInUse]", error.message); return false; }
    return !!data;
  } catch (e) {
    console.log("[isPnrInUse] exception:", e?.message || e);
    return false;
  }
}

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
    trust_score: payload.trustScore??null,
    // CERCO/VENDO flag
    cerco_vendo: (payload.cerco_vendo === "CERCO" ? "CERCO" : "VENDO"),

    // Scambio (B): solo un VENDO può accettare scambio + dichiarare cosa cerca
    accepts_swap: payload.cerco_vendo === "CERCO" ? false : !!payload.accepts_swap,
    swap_wanted: payload.cerco_vendo === "CERCO" ? null : (payload.swap_wanted ?? null),

    // hotel
    check_in: payload.type === "hotel" ? normDate(payload.check_in) : null,
    check_out: payload.type === "hotel" ? normDate(payload.check_out) : null,

    // transport
    route_from: payload.type !== "hotel" ? (payload.route_from ?? null) : null,
    route_to: payload.type !== "hotel" ? (payload.route_to ?? null) : null,
    depart_at: payload.type !== "hotel" ? normDate(payload.depart_at) : null,
    arrive_at: payload.type !== "hotel" ? normDate(payload.arrive_at) : null,
    // Operatore (Trenitalia, Italo…): solo treno, ricavato dall'AI. Mai per hotel.
    operator: payload.type !== "hotel" ? (payload.operator ?? null) : null,

    price: payload.price ?? null,
    // Prezzo di acquisto (anti-bagarinaggio): solo per un VENDO (un bene reale
    // rivenduto). Un CERCO non ha un biglietto comprato, quindi resta null.
    purchase_price: payload.cerco_vendo === "CERCO" ? null : (payload.purchase_price ?? null),
    currency: payload.currency ?? "EUR",
    status: payload.status || "active", // listing_status
  };

  const { data, error } = await supabase
    .from("listings")
    .insert([body])
    .select()
    .single();
  if (error) throw error;

  // PNR: dato riservato, salvato separatamente in listing_secrets (mai in listings)
  if (payload.pnr) {
    await savePnrSecret(data.id, payload.pnr);
  }
  return data;
}
export async function updateListing(id, patch) {
  // Il PNR non è una colonna di listings: va estratto e salvato in listing_secrets
  const { pnr, ...rest } = patch || {};

  const { data, error } = await supabase
    .from('listings')
    .update(rest)
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
  if (pnr !== undefined) {
    await savePnrSecret(id, pnr);
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



/** Elimina (definitivamente, lato UI) un mio annuncio.
 * Soft-delete verso lo stato terminale `deleted`: l'annuncio sparisce da
 * ovunque nell'app e NON è più riattivabile (a differenza di `paused`).
 * Resta la riga nel DB per non rompere lo storico di scambi/transazioni. */
export async function deleteMyListing(id) {
  const { error } = await supabase.from("listings").update({ status: "deleted" }).eq("id", id);
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
/**
 * Profilo PUBBLICO di un altro utente (venditore).
 * ⚠️ Seleziona SOLO colonne pubbliche: la RLS su `profiles` è permissiva
 * (leggibile da chiunque) ma NON protegge le colonne — leggere `phone`/
 * `email`/`*` esporrebbe dati sensibili di un altro utente. Mai farlo qui.
 */
const PUBLIC_PROFILE_COLUMNS = "id, full_name, username, avatar_url, bio, created_at, counters, email_verified";
export async function getPublicProfile(userId) {
  if (!userId) return null;
  // Preferisci la vista `public_profiles` (espone SOLO colonne pubbliche a
  // livello di DB — vedi supabase/harden_profiles_privacy.sql). Se non
  // esiste ancora, ripiega sulla tabella selezionando comunque solo le
  // colonne pubbliche (mai phone/email).
  const fromView = await supabase
    .from("public_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (!fromView.error) return fromView.data || null;

  const { data, error } = await supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Un annuncio 'active' con la data del viaggio/soggiorno già passata non è
// più azionabile (nessuno può comprare un biglietto per un treno già
// partito): va escluso dalle liste pubbliche anche se lo status in DB non è
// ancora stato aggiornato a 'expired' (la scadenza è lazy, vedi RPC
// expire_my_stale_listings — questo filtro è la difesa lato lettura,
// indipendente da quando/se quella RPC gira).
function excludeExpiredByDate(q) {
  const nowIso = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  return q.or(
    `and(type.eq.train,depart_at.gte.${nowIso}),and(type.eq.hotel,check_in.gte.${today})`
  );
}

/** Annunci attivi di uno specifico venditore (per il profilo pubblico) */
export async function listSellerActiveListings(ownerId, { limit = 50 } = {}) {
  if (!ownerId) return [];
  let q = supabase
    .from("listings")
    .select(LISTING_PUBLIC_COLUMNS)
    .eq("user_id", ownerId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);
  q = excludeExpiredByDate(q);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Lista annunci pubblici (status=active, data non ancora passata). Se
 * loggato, esclude i miei. `before` (created_at ISO dell'ultimo elemento già
 * caricato) abilita la paginazione a cursore: senza, la Esplora restava
 * fissa a un campione dei soli ultimi `limit` annunci di tutta la
 * piattaforma, senza alcun modo di vedere oltre.
 */
export async function listPublicListings({ limit = 50, excludeMine = true, before } = {}) {
  const me = await getCurrentUser().catch(() => null);
  let q = supabase
    .from("listings")
    .select(LISTING_PUBLIC_COLUMNS)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);
  q = excludeExpiredByDate(q);

  if (excludeMine && me?.id) q = q.neq("user_id", me.id);
  if (before) q = q.lt("created_at", before);
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

/**
 * Cerca tra i PROPRI annunci attivi un possibile duplicato di quello che si
 * sta per pubblicare. Ritorna { exact, similar }:
 *  - exact:   stesso tipo, prezzo e (treno) tratta+partenza / (hotel)
 *             località+check-in → pubblicazione da bloccare (stesso vincolo
 *             lato DB, vedi trigger before_insert_listings_block_duplicate).
 *  - similar: stesso tipo e stessa tratta/località ma qualche dettaglio
 *             diverso (prezzo o data) → solo avviso, si può procedere.
 * Best effort: in errore ritorna nessun duplicato (non blocca la pubblicazione
 * per un problema di rete — il backstop DB resta comunque a difesa).
 */
export async function findMyDuplicateActiveListing(payload) {
  try {
    const me = await getCurrentUser().catch(() => null);
    if (!me?.id) return { exact: null, similar: null };
    const type = payload?.type;
    if (type !== "train" && type !== "hotel") return { exact: null, similar: null };

    const { data, error } = await supabase
      .from("listings")
      .select("id, title, type, location, route_from, route_to, depart_at, check_in, price, status")
      .eq("user_id", me.id)
      .eq("status", "active")
      .eq("type", type);
    if (error || !Array.isArray(data)) return { exact: null, similar: null };

    const norm = (s) => String(s ?? "").trim().toLowerCase();
    const sameDay = (a, b) => {
      const da = a ? String(a).slice(0, 10) : "";
      const db = b ? String(b).slice(0, 10) : "";
      return !!da && da === db;
    };
    const samePrice = (a, b) => {
      const na = a == null ? null : Number(a);
      const nb = b == null ? null : Number(b);
      if (na == null && nb == null) return true;
      return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
    };

    const sameRouteOrLoc = (l) =>
      type === "train"
        ? norm(l.route_from) === norm(payload.route_from) && norm(l.route_to) === norm(payload.route_to)
        : norm(l.location) === norm(payload.location);
    const sameDate = (l) =>
      type === "train" ? sameDay(l.depart_at, payload.depart_at) : sameDay(l.check_in, payload.check_in);

    let similar = null;
    for (const l of data) {
      if (!sameRouteOrLoc(l)) continue;
      if (sameDate(l) && samePrice(l.price, payload.price)) return { exact: l, similar: null };
      if (!similar) similar = l; // stessa tratta/località ma prezzo o data diversi
    }
    return { exact: null, similar };
  } catch {
    return { exact: null, similar: null };
  }
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
    .select(LISTING_PUBLIC_COLUMNS)
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
      "id,title,type,location,route_from,route_to,check_in,check_out,depart_at,price,currency,status,created_at,user_id,is_named_ticket"
    )
    .eq("id", id)
    .eq("status", "active")
    .single();

  if (error) throw new Error(error.message || "Impossibile caricare l'annuncio");
  return data;
}