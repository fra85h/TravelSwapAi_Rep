// server/src/middleware/rateLimit.js
// Limite: 10 valutazioni ogni 10 minuti per utente (o IP fallback)
const BUCKET_WINDOW_MS = 10 * 60 * 1000; // 10 minuti
const MAX_CALLS = 10;

const buckets = new Map(); // key -> { count, resetAt }

function keyFromReq(req) {
  // se hai req.user.id usa quello; altrimenti IP
  return req.user?.id || req.ip || 'anon';
}

export function rateLimitTrustScore(req, res, next) {
  const key = keyFromReq(req);
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + BUCKET_WINDOW_MS };
    buckets.set(key, bucket);
  }

  if (bucket.count >= MAX_CALLS) {
    const retrySec = Math.ceil((bucket.resetAt - now) / 1000);
    return res.status(429).json({
      error: 'rate_limited',
      message: `Hai raggiunto il limite di ${MAX_CALLS} verifiche. Riprova tra ~${retrySec}s.`
    });
  }

  bucket.count += 1;
  next();
}
