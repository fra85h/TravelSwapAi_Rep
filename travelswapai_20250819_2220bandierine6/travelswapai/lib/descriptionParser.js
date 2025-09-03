
// travelswapai/lib/ai/descriptionParser.js
import { fetchJson } from "./backendApi";

/**
 * Chiama il backend (server/src/ai/descriptionParse.js) per parse AI.
 * Non esporre la chiave lato client.
 * @param {string} text - descrizione libera
 * @param {string} locale - "it" (default)
 * @returns {Promise<ParsedListing>}
 */
export async function parseListingFromTextAI(text, locale = "it") {
  const body = { text, locale };
  const res = await fetchJson("/ai/parse-description", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  // fetchJson di solito fa throw su errori non-2xx; qui manteniamo robustezza:
  if (!res || res.ok !== true) {
    return {
      type: null, title: null, location: null,
      checkIn: null, checkOut: null,
      departAt: null, arriveAt: null,
      isNamedTicket: null, gender: null, pnr: null, price: null
    };
  }
  const data = res.data || {};
  // Minima normalizzazione
  if (typeof data.price === "number") data.price = String(data.price);
  return {
    type: data.type ?? null,
    title: data.title ?? null,
    location: data.location ?? null,
    checkIn: data.checkIn ?? null,
    checkOut: data.checkOut ?? null,
    departAt: data.departAt ?? null,
    arriveAt: data.arriveAt ?? null,
    isNamedTicket: typeof data.isNamedTicket === "boolean" ? data.isNamedTicket : null,
    gender: data.gender ?? null,
    pnr: data.pnr ?? null,
    price: data.price ?? null,
  };
}
