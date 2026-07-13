// lib/fbLink.js — collegamento account TravelSwapAI <-> bot Messenger
// della Pagina Facebook (import annunci). Vedi server/src/routes/fbLink.js.
import { fetchJson } from "./backendApi";

/**
 * Chiede al server un codice monouso (15 minuti) da scrivere al bot
 * Messenger per collegare l'account. Richiede login (fetchJson allega
 * già il Bearer token della sessione Supabase).
 */
export async function requestFbLinkCode() {
  return fetchJson("/api/fb-link/code", { method: "POST" });
}
