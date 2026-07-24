// server/src/services/trust/computeTrustScore.js
// Motore di calcolo del TrustScore, estratto da routes/trustscore.js per
// essere riusabile anche da chi pubblica annunci senza passare dalla route
// HTTP (es. l'ingest da Facebook Feed in models/fbIngest.js) — prima quel
// canale creava annunci attivi senza NESSUNA delle verifiche che l'app
// impone invece a chi pubblica dall'app.
import { computeHeuristicChecks, isKnownRailCity } from './heuristics.js';
import { aiTrustReview } from './aiTrust.js';
import { moderateListing } from './moderation.js';

// Pesi delle tre componenti del TrustScore (vedi CLAUDE.md).
export const TRUST_WEIGHTS = { heuristics: 0.45, aiText: 0.45, aiImages: 0.10 };

/**
 * Media pesata delle tre componenti. Funzione pura (nessun accesso a
 * rete/DB), così la regola di ponderazione è verificabile da sola — vedi
 * test/fuseTrustScore.test.js.
 *
 * Un annuncio SENZA foto non viene penalizzato dalla componente "analisi
 * delle foto": il peso 0.10 è ridistribuito proporzionalmente sulle altre
 * due, invece di far pesare un punteggio immagini su immagini inesistenti.
 *
 * Due motivi. Primo, l'assenza di foto è GIÀ gestita dove deve esserlo:
 * heuristics.js aggiunge il flag NO_IMAGES con il suggerimento "Aggiungi
 * almeno 1 foto reale" e — a differenza di ogni altro controllo di quel file
 * — non decrementa alcun punteggio. Contarla anche qui significava punire due
 * volte la stessa cosa: una in modo visibile e azionabile (il flag), una in
 * modo invisibile (~4-5 punti che l'utente non sa spiegarsi). Secondo, l'AI a
 * cui non viene passata nessuna immagine restituiva imageScore: 0 — un
 * punteggio inventato sul nulla, che il default `?? 50` in aiTrust.js non
 * intercettava (copre il campo assente, non lo zero esplicito). Il risultato
 * era un annuncio all'86% con "il punto più debole è Analisi delle foto
 * (0%)": un difetto inesistente e non correggibile.
 *
 * Assenza e irrilevanza restano trattate in modo diverso: foto NON PERTINENTI
 * continuano a valere il tetto duro (IRRELEVANT_IMAGES → max 55%, applicato
 * dal chiamante), perché lì un problema reale c'è.
 */
export function fuseTrustScore({ heuristics, aiText, aiImages, hasImages }) {
  const h = Number(heuristics) || 0;
  const t = Number(aiText) || 0;
  const w = TRUST_WEIGHTS;

  if (!hasImages) {
    const base = w.heuristics + w.aiText; // 0.90
    return Math.round(((h * w.heuristics) + (t * w.aiText)) / base);
  }

  const i = Number(aiImages) || 0;
  return Math.round((h * w.heuristics) + (t * w.aiText) + (i * w.aiImages));
}

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

  // 2) AI review + moderazione contenuti: due chiamate OpenAI INDIPENDENTI
  // (la moderazione non usa il risultato della review), quindi partono
  // insieme invece che in fila — prima le due latenze si sommavano su ogni
  // Check AI e su ogni annuncio ingerito da Facebook/Instagram. Restano
  // isolate l'una dall'altra: allSettled, non all, così il fallimento di una
  // non annulla l'altra, esattamente come faceva il doppio try/catch.
  let ai = { textScore: heur.score || 50, textReason: null, imageScore: 50, flags: [], suggestedFixes: [] };
  let moderation = { flagged: false, flags: [] };

  const [aiRes, modRes] = await Promise.allSettled([
    aiTrustReview(listing, heur, locale),
    moderateListing(listing),
  ]);

  if (aiRes.status === 'fulfilled') {
    ai = aiRes.value || ai;
  } else {
    console.error('[trustscore] aiTrustReview failed:', aiRes.reason?.message || aiRes.reason);
    ai.flags.push({ code: 'AI_ERROR', msg: 'AI non disponibile, uso fallback' });
  }

  if (modRes.status === 'fulfilled') {
    moderation = modRes.value || moderation;
  } else {
    console.error('[trustscore] moderateListing failed:', modRes.reason?.message || modRes.reason);
  }

  // 3) Fusione punteggio
  const h = Number(heur?.score ?? 0);
  const t = Number(ai?.textScore ?? (h || 0));
  const i = Number(ai?.imageScore ?? 50);
  const hasImages = Array.isArray(listing.images) && listing.images.length > 0;

  let trustScore = fuseTrustScore({ heuristics: h, aiText: t, aiImages: i, hasImages });

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
    // Perché l'analisi del testo non ha dato il massimo, in una frase.
    // Serve a rendere spiegabile il caso più comune di punteggio non pieno:
    // nessun flag scattato (quelli coprono solo tratta/durata/foto/coerenza)
    // ma textScore comunque sotto 100. Prima l'utente vedeva solo "Analisi
    // del testo (AI) 90%", un numero senza motivo né azione possibile —
    // mentre CLAUDE.md chiede che il "perché" del punteggio sia SEMPRE
    // visibile. null quando il punteggio è pieno o l'AI non ha risposto.
    aiTextReason: ai?.textReason ?? null,
    subScores: {
      heuristics: h,
      aiText: t,
      // null (non "0") quando non ci sono foto: la componente non è entrata
      // nel calcolo, quindi non è un sotto-punteggio basso ma un valore che
      // non esiste. Il client scarta già i valori non finiti quando cerca "il
      // punto più debole" (vedi trustExplain in CreateListingScreen), così
      // smette di indicare come difetto principale l'analisi di foto che
      // l'utente non ha caricato.
      aiImages: hasImages ? i : null,
      consistency: Number(heur?.consistencyScore ?? 0),
      plausibility: Number(heur?.plausibilityScore ?? 0),
      completeness: Number(heur?.completenessScore ?? 0),
    },
    flags: [...(heur?.flags ?? []), ...(ai?.flags ?? []), ...(moderation?.flags ?? [])],
    suggestedFixes: [...(heur?.suggestedFixes ?? []), ...(ai?.suggestedFixes ?? [])],
    moderationFlagged: !!moderation.flagged,
  };
}
