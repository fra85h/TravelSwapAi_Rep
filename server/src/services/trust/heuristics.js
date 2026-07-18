// server/src/services/trust/heuristics.js

import crypto from 'crypto';

const suspiciousTerms = [
  'anticipo', 'caparra', 'western union', 'moneygram', 'bonifico urgente',
  'fuori piattaforma', 'telegram', 'whatsapp solo', 'codice otp', 'garanzia finta'
];

// Località italiane NON raggiungibili da rete ferroviaria (isole minori):
// backstop deterministico per le tratte treno palesemente impossibili
// (es. Lampedusa → Pantelleria), indipendente dal giudizio dell'AI e quindi
// affidabile al 100% sui casi noti anche se la chiave OpenAI è assente.
// Le isole maggiori (Sicilia, Sardegna) hanno rete ferroviaria e NON sono qui.
const NO_RAIL_PLACES = [
  // Pelagie
  'lampedusa', 'linosa', 'lampione',
  // Pantelleria
  'pantelleria',
  // Egadi
  'favignana', 'levanzo', 'marettimo',
  // Eolie
  'lipari', 'vulcano', 'stromboli', 'salina', 'panarea', 'filicudi', 'alicudi',
  // Ustica
  'ustica',
  // Pontine
  'ponza', 'ventotene', 'palmarola',
  // Golfo di Napoli
  'capri', 'ischia', 'procida',
  // Arcipelago Toscano
  'elba', 'giglio', 'capraia', 'giannutri', 'pianosa', 'montecristo', 'gorgona',
  // Isole sarde minori
  'maddalena', 'caprera', 'carloforte', 'calasetta', 'asinara',
  // Tremiti
  'tremiti', 'san domino', 'san nicola',
];

// Normalizza una località: minuscolo, senza accenti, apostrofi come spazio
// (es. "L'Aquila" -> "l aquila", altrimenti l'apostrofo non soddisfa mai il
// separatore \s+ usato dal match sulle voci multi-parola qui sotto), spazi
// compattati.
function normPlace(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’‘`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Vero se la località corrisponde a un luogo non servito da treno (match
// su parola intera, per evitare falsi positivi tipo "elbasan").
function isNoRailPlace(loc) {
  const n = normPlace(loc);
  if (!n) return false;
  return NO_RAIL_PLACES.some((p) => new RegExp(`\\b${p.replace(/ /g, '\\s+')}\\b`).test(n));
}

// La Sardegna ha una rete ferroviaria INTERNA ma nessun collegamento su
// rotaia col continente (a differenza della Sicilia, servita dal traghetto
// dei treni sullo Stretto). Una tratta Sardegna↔continente è quindi
// impossibile in treno; una tratta interna alla Sardegna è legittima.
const SARDINIA_PLACES = [
  'cagliari', 'sassari', 'olbia', 'nuoro', 'oristano', 'alghero', 'iglesias',
  'carbonia', 'porto torres', 'golfo aranci', 'macomer', 'tortoli', 'sardegna',
];
function isSardiniaPlace(loc) {
  const n = normPlace(loc);
  if (!n) return false;
  return SARDINIA_PLACES.some((p) => new RegExp(`\\b${p.replace(/ /g, '\\s+')}\\b`).test(n));
}

// Città italiane con stazione ferroviaria servita (capoluoghi + hub noti,
// incluse le principali città siciliane raggiunte dal traghetto dei treni
// sullo Stretto). Usata come ALLOW-LIST: se origine E destinazione di una
// tratta treno sono entrambe qui, la tratta è certamente percorribile sulla
// rete nazionale, quindi un IMPLAUSIBLE_ROUTE emesso dall'AI su quella tratta
// (es. Palermo→Messina, Ancona→Bari) è un falso positivo da scartare.
// Non è esaustiva: per una città non elencata si lascia decidere l'AI (così
// restano intercettabili le località inventate/assurde).
const RAIL_CITIES = [
  // Sicilia (rete FS, collegata via traghetto ferroviario)
  'palermo', 'messina', 'catania', 'siracusa', 'trapani', 'agrigento',
  'caltanissetta', 'enna', 'ragusa', 'gela', 'marsala', 'mazara del vallo',
  'cefalu', 'milazzo', 'taormina', 'giardini naxos', 'termini imerese',
  'bagheria', 'castelvetrano', 'alcamo', 'partinico', 'barcellona pozzo di gotto',
  // Calabria e Sud
  'reggio calabria', 'villa san giovanni', 'lamezia terme', 'cosenza', 'crotone',
  'catanzaro', 'paola', 'napoli', 'salerno', 'caserta', 'benevento', 'avellino',
  'bari', 'foggia', 'lecce', 'brindisi', 'taranto', 'barletta', 'trani', 'andria',
  'potenza', 'matera', 'campobasso', 'termoli',
  // Centro
  'roma', 'latina', 'frosinone', 'viterbo', 'rieti', 'civitavecchia',
  'l aquila', 'pescara', 'chieti', 'teramo', 'ancona', 'pesaro', 'macerata',
  'ascoli piceno', 'fabriano', 'perugia', 'terni', 'foligno', 'assisi', 'orte',
  'firenze', 'prato', 'pistoia', 'lucca', 'pisa', 'livorno', 'arezzo', 'siena',
  'grosseto', 'massa', 'carrara', 'viareggio', 'empoli',
  // Nord
  'bologna', 'modena', 'reggio emilia', 'parma', 'piacenza', 'ferrara',
  'ravenna', 'forli', 'cesena', 'rimini', 'imola',
  'milano', 'monza', 'bergamo', 'brescia', 'como', 'lecco', 'varese', 'pavia',
  'cremona', 'mantova', 'lodi', 'sondrio', 'lecco',
  'torino', 'novara', 'alessandria', 'asti', 'cuneo', 'biella', 'vercelli',
  'genova', 'la spezia', 'savona', 'imperia', 'ventimiglia', 'sanremo',
  'venezia', 'mestre', 'padova', 'verona', 'vicenza', 'treviso', 'rovigo',
  'belluno', 'trieste', 'udine', 'pordenone', 'gorizia',
  'trento', 'bolzano', 'rovereto', 'bressanone', 'aosta',
];
export function isKnownRailCity(loc) {
  const n = normPlace(loc);
  if (!n) return false;
  return RAIL_CITIES.some((p) => new RegExp(`\\b${p.replace(/ /g, '\\s+')}\\b`).test(n));
}

// Notti tra check-in e check-out, o null se le date mancano/non sono valide
// o l'ordine è invertito (quel caso è già coperto dal flag DATE_SWAP sopra).
function nightsBetween(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (!isFinite(s) || !isFinite(e)) return null;
  const nights = Math.round((e - s) / (1000 * 60 * 60 * 24));
  return nights > 0 ? nights : null;
}

// Testi dei suggerimenti (fix) nelle tre lingue. I messaggi dei FLAG restano
// in italiano perché il client li rimpiazza con etichette localizzate in base
// al `code`; i suggerimenti invece non hanno un code, quindi li localizziamo
// qui in base alla lingua richiesta.
const FIX_TEXT = {
  requiredField: {
    it: (f) => `Compila il campo obbligatorio: ${f}`,
    en: (f) => `Fill in the required field: ${f}`,
    es: (f) => `Rellena el campo obligatorio: ${f}`,
  },
  dateOrder: {
    it: 'Controlla l’ordine delle date',
    en: 'Check the order of the dates',
    es: 'Revisa el orden de las fechas',
  },
  pricePositive: {
    it: 'Inserisci un prezzo maggiore di 0',
    en: 'Enter a price greater than 0',
    es: 'Introduce un precio mayor que 0',
  },
  addImage: {
    it: 'Aggiungi almeno 1 immagine reale',
    en: 'Add at least 1 real photo',
    es: 'Añade al menos 1 foto real',
  },
  checkType: {
    it: 'Controlla il tipo di annuncio o allinea la descrizione',
    en: 'Check the listing type or align the description',
    es: 'Revisa el tipo de anuncio o ajusta la descripción',
  },
};
function fixText(key, locale, arg) {
  const entry = FIX_TEXT[key];
  const v = entry?.[locale] ?? entry?.it;
  return typeof v === 'function' ? v(arg) : v;
}

export function computeHeuristicChecks(listing, locale = 'it') {
  const lang = ['it', 'en', 'es'].includes(locale) ? locale : 'it';
  const flags = [];
  const fixes = [];

  const {
    type, title = '', description = '',
    origin, destination, startDate, endDate,
    price, currency = 'EUR', images = []
  } = listing;

  const text = `${title}\n${description}`.toLowerCase();

  // 1) Completezza base
  // NB: l'app manda i tipi in inglese ('train'/'hotel'); i sinonimi italiani
  // restano per retrocompatibilità (canali legacy/Messenger). Il mismatch
  // 'treno' vs 'train' teneva spenti questi controlli per i treni reali.
  let completeness = 0;
  const required = ['description', 'price', 'startDate'];
  if (type === 'hotel' || type === 'alloggio') required.push('endDate', 'destination');
  if (type === 'train' || type === 'treno' || type === 'volo' || type === 'bus') required.push('origin', 'destination');

  let present = 0;
  for (const field of required) {
    if (listing[field] !== undefined && listing[field] !== null && `${listing[field]}`.trim() !== '') {
      present++;
    } else {
      fixes.push({ field, suggestion: fixText('requiredField', lang, field) });
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
      fixes.push({ field: 'endDate', suggestion: fixText('dateOrder', lang) });
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
      fixes.push({ field: 'price', suggestion: fixText('pricePositive', lang) });
    }
    if (type === 'hotel') {
      // Il prezzo hotel è il TOTALE del soggiorno, non a notte: una soglia
      // fissa flaggava come anomalo anche un soggiorno lungo perfettamente
      // legittimo (es. 15 notti > 5000€ totali). Confrontiamo invece il
      // prezzo a notte con una soglia generosa, tenendo 5000€ come minimo
      // assoluto per i soggiorni brevi o senza date valide.
      const nights = nightsBetween(startDate, endDate);
      const cap = nights ? Math.max(5000, nights * 500) : 5000;
      if (p > cap) {
        plausibility -= 0.3;
        flags.push({
          code: 'PRICE_OUTLIER',
          msg: nights ? `Prezzo hotel anomalo per ${nights} notti` : 'Prezzo hotel anomalo',
        });
      }
    }
    if ((type === 'train' || type === 'treno' || type === 'bus') && p > 400) {
      plausibility -= 0.3;
      flags.push({ code: 'PRICE_OUTLIER', msg: 'Prezzo viaggio terrestre anomalo (oltre 400€)' });
    }
    if (type === 'volo' && p > 4000) {
      plausibility -= 0.3;
      flags.push({ code: 'PRICE_OUTLIER', msg: 'Prezzo volo anomalo' });
    }
  } else {
    plausibility -= 0.2;
    flags.push({ code: 'MISSING_PRICE', msg: 'Prezzo mancante' });
  }

  // 3b) Plausibilità tratta (solo treno): backstop deterministico su
  // origine/destinazione non raggiungibili da rotaia. Complementare al
  // controllo AI: cattura i casi ovvi con certezza, anche senza AI.
  const isTrain = type === 'train' || type === 'treno';
  if (isTrain) {
    const badOrigin = isNoRailPlace(origin);
    const badDest = isNoRailPlace(destination);
    if (badOrigin || badDest) {
      plausibility -= 0.5;
      const where = [badOrigin ? origin : null, badDest ? destination : null].filter(Boolean).join(', ');
      flags.push({ code: 'IMPLAUSIBLE_ROUTE', msg: `Tratta treno non plausibile: ${where} non è raggiungibile in treno` });
    }
    // Sardegna↔continente: nessun collegamento ferroviario attraverso il mare
    const sardOrigin = isSardiniaPlace(origin);
    const sardDest = isSardiniaPlace(destination);
    if (origin && destination && (sardOrigin !== sardDest)) {
      plausibility -= 0.5;
      flags.push({ code: 'IMPLAUSIBLE_ROUTE', msg: 'Tratta treno non plausibile: la Sardegna non è collegata al continente su rotaia' });
    }
  }

  // 4) Parole sospette
  let riskPenalty = 0;
  const hits = suspiciousTerms.filter(t => text.includes(t));
  if (hits.length) {
    riskPenalty += Math.min(0.5, 0.1 * hits.length);
    flags.push({ code: 'SUSPICIOUS_TERMS', msg: `Termini sospetti: ${hits.join(', ')}` });
  }

  // 4b) Coerenza testo ↔ tipo dichiarato. Se la descrizione/titolo parla
  // palesemente dell'altro mezzo (es. type=train ma il testo è tutto
  // "hotel/camera/notti"), l'annuncio è incoerente. Conservativo: scatta
  // solo con ALMENO due segnali forti del tipo OPPOSTO e NESSUN segnale del
  // tipo dichiarato, per evitare falsi positivi. Deterministico: complementa
  // il giudizio AI e funziona anche senza chiave OpenAI.
  const TRAIN_WORDS = ['treno', 'binario', 'carrozza', 'frecciarossa', 'frecciargento', 'frecciabianca', 'italo', 'intercity', 'regionale', 'trenitalia', 'vagone', 'posto a sedere'];
  const HOTEL_WORDS = ['hotel', 'albergo', 'camera doppia', 'camera singola', 'notti', 'pernott', 'check-in', 'check in', 'b&b', 'bed and breakfast', 'ostello', 'resort', 'soggiorno', 'mezza pensione', 'colazione inclusa'];
  const declaredTrain = type === 'train' || type === 'treno';
  const declaredHotel = type === 'hotel' || type === 'alloggio';
  if (declaredTrain || declaredHotel) {
    const ownWords = declaredTrain ? TRAIN_WORDS : HOTEL_WORDS;
    const otherWords = declaredTrain ? HOTEL_WORDS : TRAIN_WORDS;
    const hasOwn = ownWords.some((w) => text.includes(w));
    const otherHits = otherWords.filter((w) => text.includes(w));
    if (!hasOwn && otherHits.length >= 2) {
      consistency -= 0.4;
      flags.push({
        code: 'INCOHERENT_TYPE',
        msg: `La descrizione sembra riferirsi a ${declaredTrain ? 'un hotel' : 'un treno'}, ma l'annuncio è di tipo ${declaredTrain ? 'treno' : 'hotel'}`,
      });
      fixes.push({ field: 'type', suggestion: fixText('checkType', lang) });
    }
  }

  // 5) Immagini: minimo qualità e quantità
  if (images.length === 0) {
    flags.push({ code: 'NO_IMAGES', msg: 'Nessuna immagine caricata' });
    fixes.push({ field: 'images', suggestion: fixText('addImage', lang) });
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
