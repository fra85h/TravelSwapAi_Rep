// server/src/routes/clientErrors.js — raccoglie i crash dell'app web.
//
// Il client non usa l'SDK di Sentry (peserebbe 1,2 MB nel bundle, vedi la
// nota in travelswap_ai/travelswapai/lib/monitoring.js): manda qui un
// riassunto dell'errore, e questo endpoint lo inoltra a Sentry insieme a
// tutto il resto.
//
// Nessuna autenticazione, di proposito: un crash colpisce anche chi non ha
// fatto l'accesso — anzi, la schermata di login è proprio uno dei posti in
// cui non vogliamo restare ciechi. La protezione è quindi tutta nel limite
// di frequenza per IP e nella validazione severa di ciò che si accetta.
import { Router } from 'express';
import { captureError } from '../lib/monitoring.js';
import { rateLimitClientErrors } from '../middleware/rateLimit.js';

export const clientErrorsRouter = Router();

const str = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null);

clientErrorsRouter.post('/client-errors', rateLimitClientErrors, (req, res) => {
  const b = req.body || {};

  const message = str(b.message, 500);
  if (!message) {
    return res.status(400).json({ error: 'message_required' });
  }

  // Ricostruito campo per campo, mai passato così com'è: quello che arriva
  // qui viene da un browser, cioè da chiunque. Senza questo filtro un
  // client (o qualcuno che finge di esserlo) potrebbe spedire oggetti
  // arbitrariamente grandi o annidati direttamente dentro Sentry.
  const error = new Error(message);
  error.stack = str(b.stack, 4000) || error.stack;

  captureError(error, {
    origine: 'client',
    piattaforma: str(b.platform, 20),
    url: str(b.url, 300),
    userAgent: str(b.userAgent, 300),
    // Il contesto del client è un oggetto libero: si accetta solo se è
    // davvero un oggetto piatto e piccolo.
    contesto: sanitizeContext(b.context),
  });

  // 204: il client non attende la risposta e non ha niente da farsene.
  return res.status(204).end();
});

function sanitizeContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(context)) {
    if (n >= 10) break;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[String(k).slice(0, 40)] = typeof v === 'string' ? v.slice(0, 2000) : v;
      n += 1;
    }
  }
  return n ? out : null;
}
