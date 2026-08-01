// lib/searchParser.js — ricerca in linguaggio naturale (Esplora).
//
// Manda la frase scritta dall'utente al backend, che la traduce in filtri
// strutturati (server/src/ai/searchParse.js). Il filtraggio vero avviene
// poi in locale sugli annunci già caricati: qui si ottiene solo
// l'interpretazione.
import { fetchJson } from "./backendApi";

export const EMPTY_SEARCH_FILTERS = {
  type: null,
  origin: null,
  destination: null,
  location: null,
  dateFrom: null,
  dateTo: null,
  maxPrice: null,
  minPrice: null,
};

/** Vero se l'interpretazione contiene almeno un filtro utile. */
export function hasAnyFilter(f) {
  if (!f) return false;
  return Object.values(f).some((v) => v != null && v !== "");
}

/**
 * Interpreta una ricerca in linguaggio naturale.
 * L'errore viene PROPAGATO (niente oggetto vuoto silenzioso, stessa lezione
 * di parseListingFromTextAI): è il chiamante a decidere come degradare —
 * in Esplora si continua con la ricerca testuale semplice.
 */
export async function parseSearchQueryAI(query, locale = "it") {
  const res = await fetchJson("/ai/parse-search", {
    method: "POST",
    body: JSON.stringify({ query, locale }),
    headers: { "Content-Type": "application/json" },
    // Query corta, ma il server può essere freddo (Render in stand-by):
    // margine ampio come per gli altri endpoint AI, altrimenti si abortisce
    // prima ancora che il server si svegli.
    timeoutMs: 60000,
  });
  const filters = res?.filters ?? res?.data ?? null;
  return { ...EMPTY_SEARCH_FILTERS, ...(filters || {}) };
}
