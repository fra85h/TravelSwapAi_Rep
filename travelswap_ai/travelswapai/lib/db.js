// lib/db.js
import { supabase } from "./supabase";

// Colonne "pubbliche" di listings: MAI includere pnr o altri dati riservati
// (i segreti vivono in listing_secrets, lato server)
const LISTING_PUBLIC_COLUMNS =
  "id, user_id, title, description, type, location, price, currency, status, created_at, " +
  "cerco_vendo, route_from, route_to, depart_at, arrive_at, check_in, check_out, operator, " +
  "image_url, published_at, trust_score, trust_pending_at, is_named_ticket, contact_url, accepts_swap, swap_wanted, ticket_class, " +
  // Tariffa e reintestabilità: pubbliche di proposito. Il vincolo "non
  // reintestabile" deve arrivare a chi guarda l'annuncio PRIMA di fare
  // un'offerta, non dopo l'accettazione.
  "fare_type, name_change_allowed, name_change_source, " +
  "dynamic_pricing_enabled, price_floor, list_price";

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
 *
 * LANCIA in caso di errore, e deve farlo. Prima l'errore veniva solo scritto
 * in console: sembrava prudenza ("non bloccare il flusso principale"), ma il
 * rifiuto che arriva più spesso da qui è quello dell'indice
 * ux_listings_live_pnr, cioè "questo biglietto è già in vendita da qualcun
 * altro". Inghiottirlo voleva dire pubblicare comunque l'annuncio, senza PNR
 * e quindi senza impronta: fuori dall'indice anti-duplicato, invisibile al
 * controllo, con due persone che rivendono lo stesso posto e l'app che a
 * entrambe diceva "pubblicato".
 */
async function savePnrSecret(listingId, pnr) {
  const clean = pnr == null ? null : String(pnr).trim();
  if (!clean) {
    const { error } = await supabase.from("listing_secrets").delete().eq("listing_id", listingId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("listing_secrets")
    .upsert({ listing_id: listingId, pnr: clean });
  if (error) throw error;
}

/**
 * Cancella una bozza rimasta a metà. L'esito non cambia la storia: quello che
 * conta è l'errore originale, che il chiamante sta per rilanciare. Se anche
 * la cancellazione fallisce resta un annuncio in pausa — non pubblico, non
 * pericoloso, e ritrovabile dal proprietario.
 */
async function eliminaBozza(listingId) {
  const { error } = await supabase.from("listings").delete().eq("id", listingId);
  if (error) console.log("[insertListing] pulizia della bozza non riuscita:", error.message);
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

// Tetto agli annunci attivi per utente (vedi trigger DB
// enforce_active_listing_cap): 10 è ampio per un uso reale, evita che un
// account accumuli annunci attivi senza limite. excludeId: il proprio
// annuncio in modifica non conta come "un altro" annuncio attivo.
export const ACTIVE_LISTING_CAP = 10;

export async function countMyActiveListings(excludeId = null) {
  const me = await getCurrentUser();
  if (!me) throw new Error("Not authenticated");
  let q = supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", me.id)
    .eq("status", "active");
  if (excludeId != null) q = q.neq("id", String(excludeId));
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

/**
 * Censimento degli stati di TUTTI i propri annunci, senza la finestra di 100
 * righe di listMyListings.
 *
 * Serve perché i contatori del Profilo ("Attivi", "In pausa"…) erano calcolati
 * sulla lista mostrata, cioè sui 100 annunci più recenti: con 500 annunci
 * dicevano quanti attivi ci sono FRA QUEI 100, non quanti ne esistono. Chi ne
 * aveva centinaia leggeva "0 attivi" e poi si vedeva rifiutare la riattivazione
 * di un annuncio in pausa dal tetto — che invece contava quelli veri. I due
 * numeri venivano da due domande diverse e nessuno lo diceva.
 *
 * Legge solo id+status (righe minuscole), quindi anche con qualche migliaio di
 * annunci resta una singola query leggera — molto meno di una count per stato.
 */
export async function countMyListingsByStatus() {
  const me = await getCurrentUser();
  if (!me) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("listings")
    .select("id, status")
    .eq("user_id", me.id)
    .limit(10000);
  if (error) throw error;
  const byStatus = {};
  let total = 0;
  for (const row of data || []) {
    const st = String(row?.status || "active").toLowerCase();
    byStatus[st] = (byStatus[st] || 0) + 1;
    // Gli eliminati non esistono più per l'utente: fuori dal totale mostrato,
    // esattamente come sono fuori dalla lista.
    if (st !== "deleted") total += 1;
  }
  return { total, byStatus };
}

/**
 * Vero se il PNR "sembra" reale: non esiste un'API pubblica Trenitalia/Italo
 * per verificarne l'esistenza vera, quindi qui controlliamo solo la
 * plausibilità del formato (stesso range 5–8 alfanumerici già indicato
 * all'AI in fase di import, vedi lib/descriptionParser.js) e scartiamo
 * sequenze palesemente inventate ("111111", "ABCDEF"...). PNR assente →
 * true (è opzionale, il check scatta solo se presente). Stessa logica
 * duplicata lato DB (funzione pnr_is_plausible) come backstop.
 */
export function isPlausiblePnr(pnr) {
  const clean = String(pnr ?? "").trim();
  if (!clean) return true;
  const norm = clean.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (norm.length < 5 || norm.length > 8) return false;
  if (/^(.)\1*$/.test(norm)) return false; // tutto lo stesso carattere
  let asc = true, desc = true;
  for (let i = 1; i < norm.length; i++) {
    const diff = norm.charCodeAt(i) - norm.charCodeAt(i - 1);
    if (diff !== 1) asc = false;
    if (diff !== -1) desc = false;
  }
  return !(asc || desc); // sequenza banale crescente/decrescente
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
    // Verifica AI non riuscita: nessun punteggio, ma si registra QUANDO
    // ci abbiamo provato, così il ritentativo sa quali annunci riprendere.
    // trust_score NULL da solo non basta: significa già "mai verificato".
    trust_pending_at: payload.trustPendingAt ?? null,
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
    // Classe del biglietto: campo, non domanda. La riempie l'AI quando la
    // trova nel testo; se resta vuota il compratore può chiederla.
    //
    // Si accettano ENTRAMBE le grafie perché qui c'era un bug silenzioso: la
    // colonna esiste dal 26 luglio e il suo commento dice "riempita
    // dall'AI", ma questa riga leggeva `ticketClass` in camelCase mentre
    // CreateListingScreen manda snake_case come per tutti gli altri campi —
    // quindi non è mai stata scritta da nessuno, e la domanda "che classe è?"
    // finiva sempre al compratore anche quando il biglietto lo diceva.
    ticket_class: payload.type !== "hotel" ? (payload.ticket_class ?? payload.ticketClass ?? null) : null,
    // Tariffa e reintestabilità: solo treno. name_change_* vanno insieme
    // (il vincolo a DB rifiuta un valore senza origine e viceversa).
    fare_type: payload.type !== "hotel" ? (payload.fare_type ?? null) : null,
    name_change_allowed: payload.type !== "hotel" ? (payload.name_change_allowed ?? null) : null,
    name_change_source: payload.type !== "hotel" ? (payload.name_change_source ?? null) : null,

    price: payload.price ?? null,
    // Prezzo di acquisto (anti-bagarinaggio): solo per un VENDO (un bene reale
    // rivenduto). Un CERCO non ha un biglietto comprato, quindi resta null.
    purchase_price: payload.cerco_vendo === "CERCO" ? null : (payload.purchase_price ?? null),
    currency: payload.currency ?? "EUR",
    status: payload.status || "active", // listing_status

    // Prezzo dinamico: solo un VENDO ha un prezzo di vendita da scontare (un
    // CERCO usa "price" come budget massimo, non ha senso farlo "scendere").
    dynamic_pricing_enabled: payload.cerco_vendo === "CERCO" ? false : !!payload.dynamic_pricing_enabled,
    price_floor: payload.cerco_vendo === "CERCO" ? null : (payload.price_floor ?? null),
    list_price: payload.cerco_vendo === "CERCO" ? null : (payload.list_price ?? null),
  };

  // Un annuncio con PNR nasce in PAUSA e diventa pubblico solo a segreto
  // scritto. Non è prudenza generica: senza PNR l'annuncio non ha impronta,
  // quindi sfugge all'indice ux_listings_live_pnr che impedisce a due persone
  // di rivendere lo stesso biglietto. Nascendo attivo, un rifiuto del segreto
  // lasciava online proprio l'annuncio che quell'indice doveva fermare.
  // Stessa disciplina del percorso Messenger (server/src/models/fbIngest.js):
  // mai un annuncio pubblico e incompleto, nemmeno per un istante.
  //
  // I trigger che contano davvero — tetto agli annunci attivi e
  // anti-duplicato — coprono esplicitamente la transizione paused -> active
  // (vedi 20260726120000), quindi passare da qui non salta nessun controllo.
  const statoVoluto = body.status;
  const nasceInPausa = !!payload.pnr && statoVoluto === "active";

  const { data, error } = await supabase
    .from("listings")
    .insert([nasceInPausa ? { ...body, status: "paused" } : body])
    .select()
    .single();
  if (error) throw error;

  // PNR: dato riservato, salvato separatamente in listing_secrets (mai in listings)
  if (payload.pnr) {
    try {
      await savePnrSecret(data.id, payload.pnr);
    } catch (e) {
      await eliminaBozza(data.id);
      throw e;
    }
  }

  if (!nasceInPausa) return data;

  const { data: pubblicato, error: errPubblica } = await supabase
    .from("listings")
    .update({ status: statoVoluto })
    .eq("id", data.id)
    .select()
    .single();
  if (errPubblica) {
    await eliminaBozza(data.id);
    throw errPubblica;
  }
  return pubblicato;
}
export async function updateListing(id, patch) {
  // Il PNR non è una colonna di listings: va estratto e salvato in listing_secrets
  const { pnr, ...rest } = patch || {};

  // Il PNR si scrive PRIMA degli altri campi, ed è voluto. È l'unica delle
  // due scritture che una regola di business può rifiutare: se il biglietto
  // che stai dichiarando è già in vendita da qualcun altro, l'indice
  // ux_listings_live_pnr la respinge. Facendola per prima, un rifiuto lascia
  // l'annuncio esattamente com'era, invece di aver già salvato prezzo, date e
  // descrizione e dover poi spiegare che una parte è passata e una no.
  if (pnr !== undefined) {
    try {
      await savePnrSecret(id, pnr);
    } catch (e) {
      // Il chiamante controlla `upd?.error` e non si aspetta un throw
      // (CreateListingScreen fa `if (upd?.error) throw upd.error`), quindi
      // l'errore torna nella forma che già sa gestire.
      return { error: e };
    }
  }

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

/** Come getPublicProfile ma per più utenti in una volta (es. i proponenti
 * delle offerte su un annuncio) — stessa scelta vista/tabella + colonne. */
export async function getPublicProfilesByIds(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const fromView = await supabase
    .from("public_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .in("id", ids);
  if (!fromView.error) return fromView.data || [];

  const { data, error } = await supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .in("id", ids);
  if (error) throw error;
  return data || [];
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

/**
 * Il contesto di mercato per chi sta scrivendo il prezzo: gli annunci
 * confrontabili e quante persone seguono questa tratta.
 *
 * Due letture, e una sola volta: l'insieme dei confrontabili non dipende dal
 * prezzo — solo il conteggio "quanti costano meno del tuo" dipende, e quello
 * si ricalcola in locale mentre si digita (vedi lib/marketContext.mjs). Una
 * richiesta per tasto sarebbe stata inutile e costosa.
 *
 * Il conteggio di chi segue la tratta passa da una funzione del database e
 * non da una query: saved_searches è leggibile solo dal proprietario, e chi
 * ne vedesse le righe saprebbe chi cerca cosa e a quale prezzo massimo. La
 * funzione restituisce solo un numero.
 */
export async function getMarketContext({ type, cercoVendo = "VENDO", routeFrom, routeTo, location, excludeId = null } = {}) {
  const me = await getCurrentUser().catch(() => null);

  let q = supabase
    .from("listings")
    .select("id, type, price, depart_at, check_in")
    .eq("status", "active")
    .eq("type", type)
    .eq("cerco_vendo", cercoVendo)
    .limit(60);
  if (type === "hotel") {
    q = q.ilike("location", `%${String(location || "").trim()}%`);
  } else {
    q = q.ilike("route_from", `%${String(routeFrom || "").trim()}%`)
         .ilike("route_to", `%${String(routeTo || "").trim()}%`);
  }
  // I propri annunci non sono concorrenza di se stessi.
  if (me?.id) q = q.neq("user_id", me.id);

  // Le due letture in parallelo, e nessuna delle due può far fallire la
  // schermata: è un di più informativo, non un dato necessario a pubblicare.
  const [comparabili, inAttesa] = await Promise.all([
    q.then(({ data, error }) => (error ? [] : data || [])).catch(() => []),
    supabase
      .rpc("count_route_watchers", {
        p_type: type,
        p_cerco_vendo: cercoVendo,
        p_route_from: type === "hotel" ? null : routeFrom || null,
        p_route_to: type === "hotel" ? null : routeTo || null,
        p_location: type === "hotel" ? location || null : null,
      })
      // null e non 0: "non lo sappiamo" non deve diventare "nessuno".
      .then(({ data, error }) => (error ? null : data))
      .catch(() => null),
  ]);

  return { comparabili, inAttesa, excludeId };
}

/** Lista dei miei annunci */
/** Quanti annunci carica al massimo listMyListings in una volta. Esportata
 *  perché il Profilo deve poter dire "ne sto mostrando solo una parte". */
export const MY_LISTINGS_PAGE_SIZE = 100;

export async function listMyListings({ status, limit = MY_LISTINGS_PAGE_SIZE } = {}) {
  const me = await getCurrentUser();
  if (!me) throw new Error("Not authenticated");
  let q = supabase
    .from("listings")
    // Colonne esplicite invece di "*": questa lista arriva fino a 100 righe e
    // "*" trascinava anche colonne che nessuna schermata usa, tra cui
    // ai_reliability_expl (testo libero, la spiegazione estesa del punteggio).
    // Le schermate che consumano questa funzione (Profilo, Home, OfferCTA)
    // leggono solo campi già presenti qui; per modificare un annuncio si
    // naviga con il solo id e si ricarica la riga completa.
    .select(LISTING_PUBLIC_COLUMNS)
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

  if (error) { console.log("[getOfferById]", error.message); throw new Error("Impossibile caricare l'offerta"); }
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

  if (error) { console.log("[getListingById]", error.message); throw new Error("Impossibile caricare l'annuncio"); }
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

/** Offerte collegate a un annuncio (sia in entrata che in uscita).
 * Include titolo di from/to listing (embed via FK) e, per il proponente,
 * il profilo pubblico: offers.proposer_id non ha una FK verso profiles
 * (PostgREST non può fare l'embed automatico), quindi va risolto con una
 * query separata — prima mancava del tutto e OfferDetailScreen mostrava
 * sempre la parola "utente" al posto del nome vero. */
// Unico filtro dell'app costruito per interpolazione di stringa: `.or()` non
// accetta parametri, quindi l'id finisce dentro la sintassi dei filtri
// PostgREST. Un valore non-UUID potrebbe iniettare altri filtri e allargare
// la query (la RLS limita comunque le righe leggibili, ma il controllo qui
// costa nulla ed è già il pattern usato altrove nel progetto).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function listOffersForListing(listingId) {
  const id = String(listingId || "");
  if (!UUID_RE.test(id)) return [];
  const { data, error } = await supabase
    .from("offers")
    .select("*, from_listing:from_listing_id(id,title), to_listing:to_listing_id(id,title)")
    .or(`from_listing_id.eq.${id},to_listing_id.eq.${id}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data || [];

  const proposerIds = rows.map((o) => o.proposer_id).filter(Boolean);
  if (proposerIds.length) {
    try {
      const profiles = await getPublicProfilesByIds(proposerIds);
      const byId = new Map(profiles.map((p) => [String(p.id), p]));
      rows.forEach((o) => { o.proposer = byId.get(String(o.proposer_id)) || null; });
    } catch {
      // best effort: se fallisce, resta il fallback "utente" lato UI
    }
  }
  return rows;
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

  if (error) { console.log("[updateOffer]", error.message); throw new Error("Impossibile aggiornare l'offerta"); }
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

  if (error) { console.log("[getPublicListingById]", error.message); throw new Error("Impossibile caricare l'annuncio"); }
  return data;
}