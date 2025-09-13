// server/src/services/trust/heuristics.js

import crypto from 'crypto';

const suspiciousTerms = [
  'anticipo', 'caparra', 'western union', 'moneygram', 'bonifico urgente',
  'fuori piattaforma', 'telegram', 'whatsapp solo', 'codice otp', 'garanzia finta'
];

export function computeHeuristicChecks(listing) {
  const flags = [];
  const fixes = [];

  const {
    type, title = '', description = '',
    origin, destination, startDate, endDate,
    price, currency = 'EUR', images = []
  } = listing;

  const text = `${title}\n${description}`.toLowerCase();

  // 1) Completezza base
  let completeness = 0;
  const required = ['description', 'price', 'startDate'];
  if (type === 'hotel' || type === 'alloggio') required.push('endDate', 'destination');
  if (type === 'treno' || type === 'volo' || type === 'bus') required.push('origin', 'destination');

  let present = 0;
  for (const field of required) {
    if (listing[field] !== undefined && listing[field] !== null && `${listing[field]}`.trim() !== '') {
      present++;
    } else {
      fixes.push({ field, suggestion: `Compila il campo obbligatorio: ${field}` });
    }
  }
  completeness = present / required.length; // 0..1

  // 2) Consistenza date
  let consistency = 1;
  if (startDate && endDate) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isFinite(s) && isFinite(e) && e < s) {
      consistency -= 0.6;
      flags.push({ code: 'DATE_SWAP', msg: 'Data fine anteriore alla data inizio' });
      fixes.push({ field: 'endDate', suggestion: 'Controlla l’ordine delle date' });
    }
  }
  // date troppo lontane o passate
  const now = new Date();
  if (startDate) {
    const s = new Date(startDate);
    if (isFinite(s)) {
      const diffDays = (s - now) / (1000 * 60 * 60 * 24);
      if (diffDays < -1) {
        consistency -= 0.4;
        flags.push({ code: 'PAST_START', msg: 'Data di inizio nel passato' });
      }
      if (diffDays > 540) {
        consistency -= 0.2;
        flags.push({ code: 'FAR_START', msg: 'Data troppo lontana nel futuro' });
      }
    }
  }

  // 3) Prezzo plausibile (euristiche grezze per categoria)
  let plausibility = 1;
  if (price != null && Number.isFinite(Number(price))) {
    const p = Number(price);
    if (p <= 0) {
      plausibility -= 0.6;
      flags.push({ code: 'NON_POSITIVE_PRICE', msg: 'Prezzo non positivo' });
      fixes.push({ field: 'price', suggestion: 'Inserisci un prezzo maggiore di 0' });
    }
    if (type === 'hotel' && p > 5000) {
      plausibility -= 0.3;
      flags.push({ code: 'PRICE_OUTLIER', msg: 'Prezzo hotel anomalo' });
    }
    if ((type === 'treno' || type === 'bus') && p > 400) {
      plausibility -= 0.3;
      flags.push({ code: 'PRICE_OUTLIER', msg: 'Prezzo viaggio terrestre anomalo' });
    }
    if (type === 'volo' && p > 4000) {
      plausibility -= 0.3;
      flags.push({ code: 'PRICE_OUTLIER', msg: 'Prezzo volo anomalo' });
    }
  } else {
    plausibility -= 0.2;
    flags.push({ code: 'MISSING_PRICE', msg: 'Prezzo mancante' });
  }

  // 4) Parole sospette
  let riskPenalty = 0;
  const hits = suspiciousTerms.filter(t => text.includes(t));
  if (hits.length) {
    riskPenalty += Math.min(0.5, 0.1 * hits.length);
    flags.push({ code: 'SUSPICIOUS_TERMS', msg: `Termini sospetti: ${hits.join(', ')}` });
  }

  // 5) Immagini: minimo qualità e quantità
  if (images.length === 0) {
    flags.push({ code: 'NO_IMAGES', msg: 'Nessuna immagine caricata' });
    fixes.push({ field: 'images', suggestion: 'Aggiungi almeno 1 immagine reale' });
  }

  // Score parziali normalizzati 0..1
  const consistencyScore = Math.max(0, Math.min(1, consistency));
  const plausibilityScore = Math.max(0, Math.min(1, plausibility));
  const completenessScore = Math.max(0, Math.min(1, completeness));

  // Combinazione euristica
  let score =
    0.40 * consistencyScore +
    0.35 * plausibilityScore +
    0.25 * completenessScore;

  score = Math.max(0, Math.min(1, score - riskPenalty));
  const score100 = Math.round(score * 100);

  // hash anti-manomissione (opzionale)
  const signature = crypto.createHash('sha256')
    .update(JSON.stringify({ listing, score: score100 }))
    .digest('hex');

  return {
    score: score100,
    consistencyScore: Math.round(consistencyScore * 100),
    plausibilityScore: Math.round(plausibilityScore * 100),
    completenessScore: Math.round(completenessScore * 100),
    flags,
    suggestedFixes: fixes,
    signature
  };
}
