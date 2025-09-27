// travelswapai/lib/ai/descriptionParser.js
import { fetchJson } from "./backendApi";

function ensureFutureYear(isoDateTimeOrDate) {
  if (!isoDateTimeOrDate) return null;
  const s = String(isoDateTimeOrDate).replace(" ", "T");
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  // if date (or datetime) is in the past, bump year until in the future
  while (d.getTime() <= now.getTime()) {
    d.setFullYear(d.getFullYear() + 1);
  }
  const y = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  const HH = String(d.getHours()).padStart(2,"0");
  const MI = String(d.getMinutes()).padStart(2,"0");
  // preserve whether input had time
  if (/T\d{2}:\d{2}/.test(s)) return `${y}-${mm}-${dd}T${HH}:${MI}`;
  return `${y}-${mm}-${dd}`;
}

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

    let departAt = toIsoDateTime(pick(payload, "departAt", "depart_at", "departureAt", "departure_at"));
let arriveAt = toIsoDateTime(pick(payload, "arriveAt", "arrive_at", "arrivalAt", "arrival_at"));
departAt = ensureFutureYear(departAt) || departAt;
arriveAt = arriveAt ? ensureFutureYear(arriveAt) : arriveAt;
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
    };
  } catch (err) {
    // In errore: ritorna oggetto vuoto ma con chiavi previste (evita crash nel caller)
    return {
      type: null, title: null, location: null,
      checkIn: null, checkOut: null,
      departAt: null, arriveAt: null,
      isNamedTicket: null, gender: null, pnr: null, price: null, imageUrl: null
    };
  }
}
