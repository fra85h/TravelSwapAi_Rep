// lib/monitoring.js — tracciamento errori lato client.
//
// Perché serve: prima, un crash dell'app finiva in `console.error` dentro
// l'ErrorBoundary, cioè nella console del telefono di chi l'ha subito.
// Nessuno ce lo racconta: chi trova una schermata rotta se ne va. Il reset
// password è stato inservibile sul web per giorni ed è emerso solo perché
// l'ha provato il proprietario dell'app.
//
// PERCHÉ NON L'SDK DI SENTRY QUI. Provato e scartato con i numeri alla
// mano: @sentry/browser non espone sotto-percorsi (solo l'export radice) e
// Metro non fa tree-shaking, quindi finisce nel bundle per intero —
// 1,2 MB misurati, contro i ~2 KB di questo file. Un megabyte e mezzo di
// download su rete mobile per uno strumento diagnostico è un pessimo
// affare, e caricarlo pigramente al momento del crash non è meglio:
// significa scaricarlo proprio quando l'app è già rotta e la persona sta
// per andarsene.
//
// Gli errori vanno quindi al NOSTRO server (`POST /api/client-errors`),
// che li inoltra a Sentry con le stesse regole di rimozione dei dati
// personali applicate al resto. Si perde la simbolizzazione degli stack
// minificati e la cronologia delle azioni; si tiene ciò che conta davvero:
// sapere che è successo, dove, a quante persone.
import { Platform } from "react-native";

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

// Un'app rotta può generare errori a raffica (un render che fallisce in
// ciclo). Oltre questa soglia si smette: il problema è già stato segnalato,
// e continuare vorrebbe dire solo tempestare il server con la stessa cosa.
const MAX_PER_SESSION = 10;

let sent = 0;
let started = false;
// Un errore DENTRO la segnalazione non deve poter generare un'altra
// segnalazione: è il modo classico di trasformare un bug in un ciclo
// infinito che satura la rete del telefono.
let reporting = false;

export function monitoringEnabled() {
  return started && !!API_BASE;
}

// L'indirizzo della pagina può contenere il token di recupero password nel
// frammento (#access_token=...) o il codice OAuth nella query: con quelli
// si è quell'utente. Non escono da qui in nessun caso.
const safeUrl = (url) =>
  typeof url === "string" ? url.split("#")[0].split("?")[0] : null;

/** Segnala un errore già gestito. Non lancia mai, e non attende. */
export function captureError(error, context = {}) {
  if (!API_BASE || sent >= MAX_PER_SESSION || reporting) return;
  reporting = true;
  sent += 1;
  try {
    const payload = {
      message: String(error?.message || error || "errore senza messaggio").slice(0, 500),
      stack: typeof error?.stack === "string" ? error.stack.slice(0, 4000) : null,
      url:
        typeof window !== "undefined" && window.location
          ? safeUrl(window.location.href)
          : null,
      platform: Platform.OS,
      userAgent:
        typeof navigator !== "undefined" && navigator.userAgent
          ? String(navigator.userAgent).slice(0, 300)
          : null,
      context,
    };
    // Nessun await: la segnalazione non deve rallentare né bloccare ciò
    // che la stava generando. Gli errori di rete si ignorano di proposito
    // — se non arriva, non c'è niente da fare e niente da dire all'utente.
    fetch(`${API_BASE}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Volutamente muto: vedi sopra.
  } finally {
    reporting = false;
  }
}

/**
 * Aggancia i due eventi globali del browser. Da chiamare una volta sola.
 * Coprono ciò che l'ErrorBoundary di React non vede: errori fuori dal
 * ciclo di render (callback, timer) e promesse rifiutate senza catch.
 */
export function initMonitoring() {
  if (started || Platform.OS !== "web" || typeof window === "undefined") return false;
  started = true;
  window.addEventListener("error", (event) => {
    captureError(event?.error || new Error(event?.message || "errore sconosciuto"), {
      origine: "window.onerror",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    captureError(reason instanceof Error ? reason : new Error(String(reason)), {
      origine: "unhandledrejection",
    });
  });
  return true;
}
