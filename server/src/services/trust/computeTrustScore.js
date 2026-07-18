// server/src/services/trust/computeTrustScore.js
// Motore di calcolo del TrustScore, estratto da routes/trustscore.js per
// essere riusabile anche da chi pubblica annunci senza passare dalla route
// HTTP (es. l'ingest da Facebook Feed in models/fbIngest.js) — prima quel
// canale creava annunci attivi senza NESSUNA delle verifiche che l'app
// impone invece a chi pubblica dall'app.
import { computeHeuristicChecks, isKnownRailCity } from './heuristics.js';
import { aiTrustReview } from './aiTrust.js';
import { moderateListing } from './moderation.js';

/**
 * @param {object} inListing - { title, type, origin, destination, location, startDate, endDate, price, currency, images }
 * @param {string} locale - 'it' | 'en' | 'es'
 * @returns {Promise<{trustScore:number, aiAvailable:boolean, aiUnavailableReason:string|null, heuristicsAvailable:boolean, subScores:object, flags:array, suggestedFixes:array, moderationFlagged:boolean}>}
 */
export async function computeFullTrustScore(inListing, locale = 'it') {
  const listing = {
    ...inListing,
    images: Array.isArray(inListing?.images) ? inListing.images : [],
    title: inListing?.title ?? null,
    type: inListing?.type ?? null,
    origin: inListing?.origin ?? null,
    destination: inListing?.destination ?? null,
    location: inListing?.location ?? null,
    startDate: inListing?.startDate ?? null,
    endDate: inListing?.endDate ?? null,
    price: inListing?.price ?? null,
    currency: inListing?.currency ?? 'EUR',
  };

  // 1) Heuristics (isolato). Punteggio neutro (55, non 0) se il motore
  // euristico fallisce: le euristiche pesano 45% del punteggio finale, un
  // default a 0 farebbe crollare fino a 40+ punti il trustScore di un
  // annuncio legittimo per un bug SERVER, non per un problema reale.
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
  const allFlagCodes = [
    ...(heur?.flags ?? []),
    ...(ai?.flags ?? []),
  ].map((f) => String(f?.code || '').toUpperCase());

  if (allFlagCodes.includes('IMPLAUSIBLE_ROUTE')) trustScore = Math.min(trustScore, 35);
  if (allFlagCodes.includes('IMPLAUSIBLE_DURATION')) trustScore = Math.min(trustScore, 45);
  if (allFlagCodes.includes('IRRELEVANT_IMAGES')) trustScore = Math.min(trustScore, 55);
  if (allFlagCodes.includes('PRICE_OUTLIER') || allFlagCodes.includes('NON_POSITIVE_PRICE')) trustScore = Math.min(trustScore, 55);
  if (allFlagCodes.includes('SUSPICIOUS_TERMS')) trustScore = Math.min(trustScore, 45);
  if (allFlagCodes.includes('INCOHERENT_TYPE') || allFlagCodes.includes('INCOHERENT_LISTING')) trustScore = Math.min(trustScore, 50);

  // Contenuto segnalato dalla moderazione: è un problema grave e oggettivo,
  // il punteggio non può restare alto.
  if (moderation.flagged) trustScore = Math.min(trustScore, 15);

  const aiFlagCodes = (ai?.flags ?? []).map((f) => f?.code);
  const aiAvailable = !aiFlagCodes.includes('AI_DISABLED') && !aiFlagCodes.includes('AI_ERROR');

  let aiUnavailableReason = null;
  if (!aiAvailable) {
    const f = (ai?.flags ?? []).find((x) => x?.code === 'AI_DISABLED' || x?.code === 'AI_ERROR');
    aiUnavailableReason = f?.msg || 'Motivo non disponibile';
  }

  return {
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
    moderationFlagged: !!moderation.flagged,
  };
}
