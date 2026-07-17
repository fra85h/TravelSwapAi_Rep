// server/src/routes/trustscore.js
import express from 'express';
import { body, validationResult } from 'express-validator';
import { computeHeuristicChecks, isKnownRailCity } from '../services/trust/heuristics.js';
import { aiTrustReview } from '../services/trust/aiTrust.js';
import { moderateListing } from '../services/trust/moderation.js';
import { saveTrustAudit } from '../services/trust/store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimitTrustScore } from '../middleware/rateLimit.js';


export const trustscoreRouter = express.Router();

/**
 * POST /ai/trustscore
 * Body: {
 *   listing: {
 *     id, type, title, description, origin, destination,
 *     startDate, endDate, price, currency, holderName,
 *     provider, images: [ { url, width?, height? } ]
 *   }
 * }
 */
trustscoreRouter.post(
  '/trustscore',
  requireAuth, // ← assicurati che imposti req.user.id
  rateLimitTrustScore,   // ⬅️ qui
  body('listing').isObject(),
  body('listing.description').isString().isLength({ min: 10 }),
  async (req, res) => {
        const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array() });
    }

    // Lingua richiesta dal client (it/en/es): l'AI risponde in questa lingua
    // e i fix euristici deterministici vengono localizzati di conseguenza.
    const locale = ['it', 'en', 'es'].includes(req.body?.locale) ? req.body.locale : 'it';

    // 🔧 Normalizza input (evita crash su campi opzionali)
    const inListing = req.body?.listing || {};
    const listing = {
      ...inListing,
      images: Array.isArray(inListing.images) ? inListing.images : [],
      title: inListing.title ?? null,
      type: inListing.type ?? null,
      origin: inListing.origin ?? null,
      destination: inListing.destination ?? null,
      location: inListing.location ?? null,
      startDate: inListing.startDate ?? null,
      endDate: inListing.endDate ?? null,
      price: inListing.price ?? null,
      currency: inListing.currency ?? 'EUR',
    };

    if (process.env.NODE_ENV !== 'production') {
      console.log('[trustscore] incoming listing =', JSON.stringify(listing));
    }

    try {
      // 1) Heuristics (isolato). Punteggio neutro (55, non 0) se il motore
      // euristico fallisce: le euristiche pesano 45% del punteggio finale,
      // un default a 0 farebbe crollare fino a 40+ punti il trustScore di un
      // annuncio legittimo per un bug SERVER, non per un problema reale
      // dell'annuncio (stesso principio già applicato al fallback AI).
      const HEUR_NEUTRAL = { score: 55, flags: [], suggestedFixes: [], consistencyScore: 50, plausibilityScore: 50, completenessScore: 50 };
      let heur = HEUR_NEUTRAL;
      let heuristicsAvailable = true;
      try {
        heur = computeHeuristicChecks(listing, locale) || HEUR_NEUTRAL;
      } catch (e) {
        console.error('[trustscore] heuristics failed:', e);
        heuristicsAvailable = false;
        heur = { ...HEUR_NEUTRAL, flags: [{ code: 'HEUR_ERROR', msg: 'Heuristics non disponibili' }] };
      }

      // 2) AI review (isolata, con fallback se manca chiave o modulo)
      let ai = { textScore: heur.score || 50, imageScore: 50, flags: [], suggestedFixes: [] };
      try {
        ai = (await aiTrustReview(listing, heur, locale)) || ai;
      } catch (e) {
        console.error('[trustscore] aiTrustReview failed:', e?.message || e);
        ai.flags.push({ code: 'AI_ERROR', msg: 'AI non disponibile, uso fallback' });
      }

      // 2b) Moderazione contenuti (isolata, fail-safe: non blocca mai)
      let moderation = { flagged: false, flags: [] };
      try {
        moderation = (await moderateListing(listing)) || moderation;
      } catch (e) {
        console.error('[trustscore] moderateListing failed:', e?.message || e);
      }

      // 3) Fusione punteggio
  const weights = { heuristics: 0.45, aiText: 0.45, aiImages: 0.10 };

const h = Number(heur?.score ?? 0);
const t = Number(ai?.textScore ?? (h || 0));
const i = Number(ai?.imageScore ?? 50);

let trustScore = Math.round(
  (h * weights.heuristics) +
  (t * weights.aiText) +
  (i * weights.aiImages)
);

// Falsi positivi di tratta: l'AI a volte segnala IMPLAUSIBLE_ROUTE su tratte
// reali (es. Palermo→Messina, Ancona→Bari). Il layer deterministico è
// l'autorità sui casi davvero impossibili (isole minori, Sardegna↔continente).
// Quindi: se la tratta treno è tra due città ferroviarie note e le euristiche
// NON l'hanno segnalata, l'IMPLAUSIBLE_ROUTE dell'AI è quasi certamente errato
// → lo rimuoviamo (niente flag mostrato, niente cap del punteggio). Le tratte
// con una città non in allow-list restano invece valutate dall'AI.
const heurFlagCodes = (heur?.flags ?? []).map((f) => String(f?.code || '').toUpperCase());
const isTrainListing = ['train', 'treno'].includes(String(listing.type || '').toLowerCase());
if (
  isTrainListing &&
  isKnownRailCity(listing.origin) &&
  isKnownRailCity(listing.destination) &&
  !heurFlagCodes.includes('IMPLAUSIBLE_ROUTE')
) {
  const before = (ai?.flags ?? []).length;
  ai.flags = (ai?.flags ?? []).filter((f) => String(f?.code || '').toUpperCase() !== 'IMPLAUSIBLE_ROUTE');
  if (ai.flags.length !== before && process.env.NODE_ENV !== 'production') {
    console.log(`[trustscore] soppresso IMPLAUSIBLE_ROUTE AI (falso positivo): ${listing.origin} → ${listing.destination}`);
  }
}

// Tetti per flag gravi: la media pesata 45/45/10 diluisce i problemi
// oggettivi (una tratta impossibile con punteggio 83% è fuorviante).
// Un flag grave deve dominare il punteggio, non contribuirvi in media.
const allFlagCodes = [
  ...(heur?.flags ?? []),
  ...(ai?.flags ?? []),
].map((f) => String(f?.code || '').toUpperCase());

if (allFlagCodes.includes('IMPLAUSIBLE_ROUTE')) {
  trustScore = Math.min(trustScore, 35);
}
if (allFlagCodes.includes('IMPLAUSIBLE_DURATION')) {
  trustScore = Math.min(trustScore, 45);
}
if (allFlagCodes.includes('IRRELEVANT_IMAGES')) {
  trustScore = Math.min(trustScore, 55);
}
if (allFlagCodes.includes('PRICE_OUTLIER') || allFlagCodes.includes('NON_POSITIVE_PRICE')) {
  trustScore = Math.min(trustScore, 55);
}
if (allFlagCodes.includes('SUSPICIOUS_TERMS')) {
  trustScore = Math.min(trustScore, 45);
}
// Annuncio incoerente (testo che contraddice i campi, o tipo sbagliato):
// non è per forza una truffa ma è confuso e poco affidabile.
if (allFlagCodes.includes('INCOHERENT_TYPE') || allFlagCodes.includes('INCOHERENT_LISTING')) {
  trustScore = Math.min(trustScore, 50);
}

// Contenuto segnalato dalla moderazione: è un problema grave e oggettivo,
// il punteggio non può restare alto — lo forziamo verso il basso.
if (moderation.flagged) {
  trustScore = Math.min(trustScore, 15);
}

// Se l'AI non ha potuto valutare (chiave assente o errore), il punteggio
// si basa sulle sole euristiche: va detto chiaramente all'utente invece
// di mostrare un numero apparentemente altrettanto autorevole.
const aiFlagCodes = (ai?.flags ?? []).map((f) => f?.code);
const aiAvailable = !aiFlagCodes.includes('AI_DISABLED') && !aiFlagCodes.includes('AI_ERROR');

// Motivo preciso quando l'AI non è disponibile: il client lo mostra SOLO
// nella versione web (per test); nell'app nativa resta il messaggio
// generico. Utile per distinguere "chiave mancante" da "chiamata fallita".
let aiUnavailableReason = null;
if (!aiAvailable) {
  const f = (ai?.flags ?? []).find((x) => x?.code === 'AI_DISABLED' || x?.code === 'AI_ERROR');
  aiUnavailableReason = f?.msg || 'Motivo non disponibile';
}

const response = {
  trustScore,
  aiAvailable,
  aiUnavailableReason,
  heuristicsAvailable,
  subScores: {
    heuristics: h,
    aiText: t,
    aiImages: i,
    consistency: Number(heur?.consistencyScore ?? 0),
    plausibility: Number(heur?.plausibilityScore ?? 0),
    completeness: Number(heur?.completenessScore ?? 0),
  },
  flags: [...(heur?.flags ?? []), ...(ai?.flags ?? []), ...(moderation?.flags ?? [])],
  suggestedFixes: [...(heur?.suggestedFixes ?? []), ...(ai?.suggestedFixes ?? [])],
  metadata: {
    version: '1.1.0',
    listingId: listing.id ?? null,
    evaluatedAt: new Date().toISOString(),
  },
};
      // 4) Salvataggio audit (non deve mai rompere la risposta)
      try {
        const userId = req.user?.id ?? null;
        await saveTrustAudit({
          userId,
          listingId: listing.id ?? null,
          payload: response,
        });
      } catch (e) {
        console.error('[trustscore] saveTrustAudit failed:', e?.message || e);
      }

      return res.json(response);
    } catch (e) {
      console.error('[trustscore] fatal error:', e);
      return res.status(500).json({ error: 'TrustScore computation failed' });
    }
   }
 );