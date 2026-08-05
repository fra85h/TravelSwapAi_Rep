// server/src/lib/monitoring.js — segnalazione manuale degli errori.
//
// Passare da qui invece di importare Sentry ovunque tiene i punti di
// chiamata indipendenti dal fornitore, e soprattutto garantisce che senza
// SENTRY_DSN non succeda niente: nessun test e nessun ambiente di sviluppo
// deve poter mandare dati fuori per sbaglio.
import { Sentry, monitoringEnabled } from '../instrument.js';

/**
 * Registra un errore che il codice ha già gestito (una `catch` che non
 * rilancia). Quelli che risalgono fino a express li prende da sé il
 * gestore montato in index.js.
 *
 * Non lancia mai: un problema nel tracciamento non deve poter rompere la
 * richiesta che stava tracciando.
 */
export function captureError(error, context = {}) {
  if (!monitoringEnabled()) return;
  try {
    Sentry.captureException(error, { extra: context });
  } catch (e) {
    console.error('[monitoring] impossibile segnalare l\'errore:', e?.message || e);
  }
}

// Ogni quanto ri-segnalare lo STESSO guasto. Senza questo freno, un
// fornitore giù (OpenAI senza credito, database irraggiungibile) produce
// una segnalazione per ogni richiesta: con 5.000 eventi al mese sul piano
// gratuito, un pomeriggio di disservizio brucia la quota e le settimane
// dopo restiamo ciechi proprio mentre paghiamo per non esserlo.
const FAULT_THROTTLE_MS = 5 * 60 * 1000;
const lastReported = new Map();
let lastSweep = Date.now();

function shouldReport(key) {
  const now = Date.now();
  // Pulizia periodica: senza, ogni messaggio d'errore mai visto resta in
  // memoria per sempre su un processo che non riparte mai.
  if (now - lastSweep > FAULT_THROTTLE_MS) {
    lastSweep = now;
    for (const [k, t] of lastReported) {
      if (now - t > FAULT_THROTTLE_MS) lastReported.delete(k);
    }
  }
  const prev = lastReported.get(key);
  if (prev && now - prev < FAULT_THROTTLE_MS) return false;
  lastReported.set(key, now);
  return true;
}

/**
 * Un guasto: qualcosa che DOVEVA funzionare e non ha funzionato.
 *
 * Da usare al posto di `console.error` nei punti dove il codice cattura
 * un'eccezione e prosegue con un ripiego — sono esattamente i guasti che
 * restavano invisibili, perché gestiti con eleganza: credito OpenAI
 * esaurito, email non partita, documento illeggibile. Il ripiego salva
 * l'utente, il silenzio sepolliva il problema.
 *
 * NON va usato per gli errori dell'utente (input non valido, limite di
 * frequenza raggiunto, ricerca incomprensibile): quelli non sono guasti, e
 * riempirebbero il tracciamento di rumore fino a renderlo inutile.
 *
 * Il log resta SEMPRE, anche senza Sentry configurato e anche quando la
 * segnalazione viene soffocata dal freno: i log sono il posto dove si
 * guarda quando si sta già indagando.
 */
export function reportFault(scope, error, extra = {}) {
  const err = error instanceof Error
    ? error
    : new Error(String(error?.message || error || "errore senza messaggio"));
  console.error(`[${scope}]`, err.message || err);
  if (!monitoringEnabled()) return;
  if (!shouldReport(`${scope}:${err.message}`.slice(0, 200))) return;
  captureError(err, { scope, ...extra });
}

/** Solo per i test. */
export function __resetFaultThrottleForTests() {
  lastReported.clear();
  lastSweep = Date.now();
}

/** Annota un evento non eccezionale ma degno di nota (es. quota esaurita). */
export function captureMessage(message, context = {}) {
  if (!monitoringEnabled()) return;
  try {
    Sentry.captureMessage(message, { level: 'warning', extra: context });
  } catch (e) {
    console.error('[monitoring] impossibile segnalare il messaggio:', e?.message || e);
  }
}

export { monitoringEnabled };
