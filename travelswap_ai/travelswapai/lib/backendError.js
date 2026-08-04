// lib/backendError.js — tira fuori il motivo vero da un errore del backend.
//
// fetchJson lancia messaggi fatti per chi legge i log, non per chi usa
// l'app: `HTTP 502: Bad Gateway — {"ok":false,"error":"Il servizio AI ha
// risposto in un formato non valido."}`. Dentro c'è l'unica frase che
// serve davvero, ma finora veniva scartata: ogni guasto diverso finiva
// dietro lo stesso messaggio generico, e chi lo subiva non aveva modo di
// dirci cosa fosse successo.
//
// Non sostituisce il messaggio comprensibile: lo affianca, fra parentesi.

/** Riconosce i timeout, che hanno una forma tutta loro. */
const TIMEOUT_RE = /^Timeout dopo (\d+)ms/;

/**
 * @param {unknown} err errore lanciato da fetchJson (o qualunque altro)
 * @returns {string|null} una frase breve da mostrare, o null se non c'è
 *   niente di più utile del messaggio generico già mostrato
 */
export function describeBackendError(err) {
  // Il messaggio si legge dal campo, non dall'oggetto: `String(new
  // Error(""))` dà "Error", cioè una parola che non dice niente e che
  // finirebbe fra parentesi sotto l'avviso all'utente.
  const raw = (typeof err?.message === "string" && err.message.trim())
    || (typeof err === "string" && err.trim())
    || "";
  if (!raw) return null;

  const timeout = raw.match(TIMEOUT_RE);
  if (timeout) {
    const sec = Math.round(Number(timeout[1]) / 1000);
    return `nessuna risposta dopo ${sec}s`;
  }

  // Corpo JSON accodato dopo " — ": è lì che sta il messaggio del server.
  const sep = raw.indexOf(" — ");
  if (sep >= 0) {
    const tail = raw.slice(sep + 3).trim();
    try {
      const parsed = JSON.parse(tail);
      const msg = parsed?.error || parsed?.message;
      if (msg) return String(msg).slice(0, 200);
    } catch {
      // Non era JSON (es. una pagina HTML di un proxy): si mostra
      // comunque l'inizio, che dice più di niente.
      if (tail) return tail.slice(0, 200);
    }
  }

  // Codice HTTP senza corpo: almeno quello.
  const http = raw.match(/^HTTP (\d{3})/);
  if (http) return `HTTP ${http[1]}`;

  return raw.slice(0, 200);
}
