// lib/priceVerdict.js — il prezzo scritto dal venditore è fuori mercato?
//
// Confronto deterministico fra il prezzo digitato e la stima dell'AI
// (POST /api/listings/price-suggest, la stessa che alimenta il bottone
// "Suggerimento prezzo"): all'AI si chiede una stima, non un giudizio.
// Il giudizio lo dà questa funzione, che è pura, testabile e uguale per
// tutti — così due venditori con lo stesso prezzo vedono lo stesso avviso,
// cosa che chiedendo un verdetto al modello non sarebbe garantita.
//
// PERCHÉ SOLO "TROPPO ALTO". Un prezzo sopra mercato è un problema
// concreto: l'annuncio non riceve offerte e la persona non capisce perché.
// Un prezzo sotto mercato invece è una scelta legittima di chi vende, e
// segnalarlo equivarrebbe a spingere i prezzi verso l'alto su un
// marketplace che ha come principio il tetto del prezzo pagato. Si tace.

export const PRICE_VERDICT = {
  HIGH: "high",
  OK: "ok",
  UNKNOWN: "unknown",
};

// Quanto sopra la stima far scattare l'avviso. Le stime dell'AI sono
// rumorose: sotto il 25% si finirebbe ad avvisare per differenze che non
// significano niente, e un avviso che compare sempre smette di essere
// letto.
export const HIGH_THRESHOLD = 1.25;

/**
 * @param {number|string|null} entered prezzo digitato dal venditore
 * @param {number|string|null} suggested stima dell'AI
 * @returns {"high"|"ok"|"unknown"}
 */
export function priceVerdict(entered, suggested) {
  const p = Number(entered);
  const s = Number(suggested);
  // Senza una stima valida non si giudica: UNKNOWN è una risposta, e
  // significa che non si mostra niente.
  if (!Number.isFinite(p) || p <= 0) return PRICE_VERDICT.UNKNOWN;
  if (!Number.isFinite(s) || s <= 0) return PRICE_VERDICT.UNKNOWN;
  return p > s * HIGH_THRESHOLD ? PRICE_VERDICT.HIGH : PRICE_VERDICT.OK;
}

/** Di quanto è sopra la stima, in percentuale intera (per il messaggio). */
export function percentAbove(entered, suggested) {
  const p = Number(entered);
  const s = Number(suggested);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0) return null;
  const pct = Math.round(((p - s) / s) * 100);
  return pct > 0 ? pct : null;
}
