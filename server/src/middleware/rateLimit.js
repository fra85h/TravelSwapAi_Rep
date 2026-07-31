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

// Link pausa/elimina nell'email di segnalazione: nessun login (chi clicca
// non ha una sessione), quindi il bucket è per IP. Il token è già
// imprevedibile (32 byte casuali) e monouso — questo limite è solo un
// backstop contro tentativi di indovinare/riprovare in loop.
export const rateLimitReportActions = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'richieste' });

export const rateLimitNotify = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 30, name: 'notifiche' });

// Endpoint di matching: sono i più costosi del server (fan-out sugli altri
// utenti in /propagate e /retract, chiamate OpenAI in /ai/recompute) ed erano
// gli unici senza alcun freno — bastava un client che li richiamasse in loop
// per saturare il processo. Due limiti distinti: quelli deterministici
// (snapshot/propagate/retract) sono invocati fire-and-forget dal client a ogni
// pubblicazione/pausa, quindi hanno più margine; il ricalcolo AI costa soldi
// veri per chiamata e sta molto più basso.
export const rateLimitMatchRecompute = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 30, name: 'ricalcoli match' });
export const rateLimitMatchAI = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 6, name: 'ricalcoli AI' });

// Limite endpoint cron scambi a catena: protetto solo da un secret condiviso
// (nessun login utente, quindi il bucket è per IP), gli mancava un freno di
// frequenza sui tentativi di indovinare X-Cron-Secret.
export const rateLimitChains = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'richieste cron' });

// Stesso principio di rateLimitChains: endpoint cron avvisi di ricerca,
// protetto solo dal secret condiviso, senza freno di frequenza.
export const rateLimitSavedSearches = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'richieste cron' });

// Stesso principio di rateLimitChains: endpoint cron scadenza proposte,
// protetto solo dal secret condiviso, senza freno di frequenza.
export const rateLimitOffers = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'richieste cron' });

// Stesso principio di rateLimitChains: endpoint cron prezzo dinamico,
// protetto solo dal secret condiviso, senza freno di frequenza.
export const rateLimitPriceDecay = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'richieste cron' });

// Limite feature "Ping" (segnala il tuo VENDO a chi cerca): 20 ogni 10 minuti
// per utente. Il vincolo UNIQUE lato DB impedisce comunque i duplicati sulla
// stessa coppia di annunci: questo limite frena solo il volume di segnalazioni.
export const rateLimitPings = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'segnalazioni' });

// Domande sugli annunci: a risposta chiusa e con vincolo di unicità a DB
// (una per persona per annuncio), quindi il tetto serve solo a impedire che
// qualcuno le sparpagli su decine di annunci diversi in pochi minuti.
export const rateLimitQuestions = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'domande' });

// Risoluzione dispute: protetto da requireAdminSecret (nessun concetto di
// ruolo admin nel DB), azione manuale rara — il tetto è solo un backstop,
// non ci si aspetta mai di avvicinarcisi in uso normale.
export const rateLimitDisputes = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, name: 'risoluzione dispute' });
