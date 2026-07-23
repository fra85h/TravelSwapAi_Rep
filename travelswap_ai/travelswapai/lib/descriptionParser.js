// travelswapai/lib/ai/descriptionParser.js
import { fetchJson } from "./backendApi";

function makeRoute(origin, destination) {
  const a = normStr(origin);
  const b = normStr(destination);
  if (!a && !b) return null;
  if (!b) return a;
  if (!a) return b;
  return `${a}-->${b}`;
}

function makeTitle(cercoVendo, type, route) {
  // Ignore price in title; always use "Vendo treno ... solo andata"
  const action = (String(cercoVendo||"").toUpperCase() === "CERCO") ? "Cerco" : "Vendo";
  if (String(type||"").toLowerCase() === "train" && route) {
    return `${action} treno ${route} solo andata`;
  }
  return route ? `${action} ${route}` : action;
}


/**
 * Normalizza stringa (trim, svuota se falsy)
 */
function normStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Forza ISO datetime: sostituisce spazio con 'T' e taglia i secondi.
 * Accetta "YYYY-MM-DD HH:mm" o "YYYY-MM-DDTHH:mm[:ss]".
 */
function toIsoDateTime(v) {
  const s = normStr(v);
  if (!s) return null;
  const t = s.replace(" ", "T");
  // mantieni solo fino ai minuti (se arrivano i secondi li tagliamo)
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : t;
}

/**
 * Forza ISO date: "YYYY-MM-DD"
 */
function toIsoDate(v) {
  const s = normStr(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? s : s.split("T")[0] || null;
}

/**
 * Coerce/normalizza numero prezzo in stringa con '.' come decimale
 */
function normPrice(v) {
  if (v == null) return null;
  const s = String(v).replace(",", ".").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : null;
}

/**
 * Mappa robusta: accetta sia camelCase che snake_case dal backend
 */
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
  }
  return null;
}

/**
 * Chiama il backend per fare il parsing AI della descrizione.
 * @param {string} text - descrizione libera
 * @param {string} locale - es. "it"
 * @returns {Promise<{
 *  type:string|null, title:string|null, location:string|null,
 *  checkIn:string|null, checkOut:string|null,
 *  departAt:string|null, arriveAt:string|null,
 *  isNamedTicket:boolean|null, gender:string|null, pnr:string|null, price:string|null, imageUrl:string|null
 * }>}
 */
export async function parseListingFromTextAI(text, locale = "it") {
  try {
    const body = { text, locale };
    const res = await fetchJson("/ai/parse-description", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return normalizeParsedPayload(res);
  } catch (err) {
    return emptyParsed();
  }
}

/**
 * Parsing AI di un PDF di biglietto/conferma (base64, senza prefisso data:).
 * Stesso schema di risposta di parseListingFromTextAI. Il `price` estratto è
 * il prezzo REALE pagato indicato nel documento: il chiamante lo usa per
 * precompilare il prezzo di acquisto (assist anti-bagarinaggio).
 * A differenza del parser testuale, qui l'errore viene PROPAGATO (non
 * inghiottito): se il PDF non si può leggere l'utente deve saperlo, non
 * ritrovarsi un form silenziosamente vuoto.
 */
export async function parseListingFromPdfAI(pdfBase64, locale = "it") {
  const res = await fetchJson("/ai/parse-ticket-pdf", {
    method: "POST",
    body: JSON.stringify({ pdfBase64, locale }),
    headers: { "Content-Type": "application/json" },
    // il modello deve leggere l'intero documento: più lento del testo
    timeoutMs: 90000,
  });
  return normalizeParsedPayload(res);
}

function emptyParsed() {
  return {
    type: null, title: null, location: null,
    checkIn: null, checkOut: null,
    departAt: null, arriveAt: null,
    isNamedTicket: null, gender: null, pnr: null, price: null, imageUrl: null,
    provider: null, cercoVendo: null,
  };
}

function normalizeParsedPayload(res) {
    // Se fetchJson già fa throw su 4xx/5xx, qui arriviamo solo con res valido.
    // In alcuni progetti fetchJson ritorna { ok, data }. In altri ritorna direttamente il payload.
    const payload = res?.data ?? res ?? {};

    const type = normStr(pick(payload, "type"));
let title = normStr(pick(payload, "title"));
const origin = normStr(pick(payload, "origin"));
const destination = normStr(pick(payload, "destination"));
let location = makeRoute(origin, destination) || normStr(pick(payload, "location"));

    const checkIn  = toIsoDate(pick(payload, "checkIn", "check_in"));
    const checkOut = toIsoDate(pick(payload, "checkOut", "check_out"));

    // NIENTE rollover forzato dell'anno qui: una data con anno esplicito già
    // nel passato è un biglietto scaduto/non valido, non va spostata in
    // avanti (bug storico: "8 marzo 2026" finiva pubblicato come "8 marzo
    // 2027"). La data nel passato viene bloccata in creazione annuncio.
    const departAt = toIsoDateTime(pick(payload, "departAt", "depart_at", "departureAt", "departure_at"));
const arriveAt = toIsoDateTime(pick(payload, "arriveAt", "arrive_at", "arrivalAt", "arrival_at"));
const isNamedTicketRaw = pick(payload, "isNamedTicket", "is_named_ticket");
    const isNamedTicket =
      typeof isNamedTicketRaw === "boolean"
        ? isNamedTicketRaw
        : (String(isNamedTicketRaw).toLowerCase() === "true" ? true :
           (String(isNamedTicketRaw).toLowerCase() === "false" ? false : null));

    const gender = normStr(pick(payload, "gender"));
    const pnr = normStr(pick(payload, "pnr", "bookingCode", "booking_code"));
    const price = normPrice(pick(payload, "price", "amount", "total"));
    const imageUrl = normStr(pick(payload, "imageUrl", "image_url", "image"));
    const provider = normStr(pick(payload, "provider"));
    const cercoVendo = (() => {
      const v = String(pick(payload, "cercoVendo", "cerco_vendo") ?? "").toUpperCase();
      return v === "CERCO" || v === "VENDO" ? v : null;
    })();

    return {
      type: type ?? null,
      title: title ?? null,
      location: location ?? null,
      checkIn: checkIn ?? null,
      checkOut: checkOut ?? null,
      departAt: departAt ?? null,
      arriveAt: arriveAt ?? null,
      isNamedTicket,
      gender: gender ?? null,
      pnr: pnr ?? null,
      price: price ?? null,
      imageUrl: imageUrl ?? null,
      provider: provider ?? null,
      cercoVendo,
    };
}
