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
