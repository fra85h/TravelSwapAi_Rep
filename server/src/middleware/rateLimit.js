// server/src/middleware/rateLimit.js
// Rate limiter in-memory per utente (o IP fallback), a finestra fissa.
// NB: con più istanze del server serve uno store condiviso (Redis/Postgres).

function keyFromReq(req) {
  // se hai req.user.id usa quello; altrimenti IP
  return req.user?.id || req.ip || 'anon';
}

/**
 * Crea un middleware di rate limiting.
 * @param {{ windowMs?: number, max?: number, name?: string }} opts
 */
export function makeRateLimiter({ windowMs = 10 * 60 * 1000, max = 10, name = 'richieste' } = {}) {
  const buckets = new Map(); // key -> { count, resetAt }
  let lastSweep = Date.now();

  // Senza pulizia, ogni chiave vista anche una sola volta (utente o IP)
  // resta in memoria per sempre: su un processo long-running con molti
  // utenti/IP diversi nel tempo è un leak lento. Una sweep delle voci
  // scadute ogni windowMs (non a ogni richiesta) tiene la Map limitata
  // senza aggiungere overhead O(n) su ogni singola chiamata.
  function sweepExpired(now) {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [k, b] of buckets) {
      if (now > b.resetAt) buckets.delete(k);
    }
  }

  return function rateLimit(req, res, next) {
    const key = keyFromReq(req);
    const now = Date.now();
    sweepExpired(now);

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= max) {
      const retrySec = Math.ceil((bucket.resetAt - now) / 1000);
      return res.status(429).json({
        error: 'rate_limited',
        message: `Hai raggiunto il limite di ${max} ${name}. Riprova tra ~${retrySec}s.`
      });
    }

    bucket.count += 1;
    next();
  };
}

// Limite: 10 valutazioni ogni 10 minuti per utente (o IP fallback)
export const rateLimitTrustScore = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, name: 'verifiche' });

// Limite traduzioni: 30 ogni 10 minuti per utente (le chiamate OpenAI hanno un costo)
export const rateLimitTranslate = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 30, name: 'traduzioni' });

// Limite parsing descrizioni: 20 ogni 10 minuti per utente
export const rateLimitParse = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'analisi del testo' });

// Limite analisi prezzo: 20 ogni 10 minuti per utente
export const rateLimitPriceCheck = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'analisi prezzo' });

// Limite notifiche segnalazione: 10 ogni 10 minuti per utente
export const rateLimitReportNotify = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, name: 'segnalazioni' });

// Limite endpoint cron scambi a catena: protetto solo da un secret condiviso
// (nessun login utente, quindi il bucket è per IP), gli mancava un freno di
// frequenza sui tentativi di indovinare X-Cron-Secret.
export const rateLimitChains = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'richieste cron' });
