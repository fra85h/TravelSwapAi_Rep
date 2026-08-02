// server/src/instrument.js — avvio del tracciamento errori (Sentry).
//
// Va importato per PRIMO in index.js: i moduli ES vengono valutati
// nell'ordine in cui sono dichiarati, quindi questa riga inizializza Sentry
// prima che express e i router esistano. Questo copre la segnalazione degli
// errori, che è lo scopo. Il tracciamento delle prestazioni richiederebbe
// anche `node --import ./src/instrument.js src/index.js`: non lo facciamo
// perché legherebbe il funzionamento al comando di avvio configurato su
// Render, e un tracciamento che smette di funzionare quando qualcuno cambia
// una riga nel pannello è peggio di uno che non c'è.
//
// Senza SENTRY_DSN non fa NIENTE: in sviluppo e nei test non parte alcuna
// connessione verso l'esterno, e il resto del server si comporta come prima.
import 'dotenv/config';
import * as Sentry from '@sentry/node';

const DSN = (process.env.SENTRY_DSN || '').trim();

// Chiavi che non devono uscire da qui in nessun caso. Sentry con
// sendDefaultPii:false già evita corpo della richiesta e indirizzo IP, ma
// gli header arrivano comunque: `authorization` contiene il token di
// sessione dell'utente, e con quello si è quella persona.
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'apikey', 'x-api-key', 'x-hub-signature-256'];

function scrub(event) {
  const req = event.request;
  if (req) {
    delete req.cookies;
    // Il corpo di una richiesta qui dentro può contenere il testo di una
    // chat o il codice di prenotazione di un biglietto: non serve a
    // diagnosticare un errore e non deve finire da un fornitore terzo.
    delete req.data;
    if (req.headers) {
      for (const h of Object.keys(req.headers)) {
        if (SENSITIVE_HEADERS.includes(h.toLowerCase())) req.headers[h] = '[rimosso]';
      }
    }
    // La query string finisce nell'URL: i webhook Meta ci passano il token
    // di verifica, e il flusso OAuth il codice di scambio.
    if (typeof req.query_string === 'string') delete req.query_string;
    if (typeof req.url === 'string') req.url = req.url.split('?')[0];
  }
  return event;
}

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV || 'development',
    // Nessun dato personale raccolto in automatico: niente IP, niente
    // corpo delle richieste, niente identità dell'utente.
    sendDefaultPii: false,
    // Solo errori. Il tracciamento delle prestazioni consuma la quota
    // gratuita in fretta e non è il problema che stiamo risolvendo.
    tracesSampleRate: 0,
    beforeSend: scrub,
  });
  console.log('[monitoring] Sentry attivo (environment:', process.env.NODE_ENV || 'development', ')');
} else {
  console.warn('[monitoring] SENTRY_DSN non configurata: gli errori restano solo nei log.');
}

export const monitoringEnabled = () => !!DSN;
export { Sentry };
