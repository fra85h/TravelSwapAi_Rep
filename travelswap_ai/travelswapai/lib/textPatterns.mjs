// lib/textPatterns.mjs
// Espressioni regolari e funzioni pure che interpretano il TESTO scritto
// dall'utente (descrizione di un annuncio, biglietto incollato).
//
// Perché un file a parte, e perché .mjs: queste regole decidono cose
// pesanti — la direzione del denaro (CERCO/VENDO), la tratta, le date, il
// PNR, se l'annuncio sembra contenere due biglietti — e finora vivevano
// dentro un componente React da 3200 righe, quindi non erano verificabili
// da nessun test. La CI esegue solo la suite del server (`cd server &&
// node --test`) e i file .js dell'app non sono importabili da Node, perché
// quel package non dichiara "type": "module". L'estensione .mjs è ESM per
// definizione, indipendentemente dal package.json: così lo stesso modulo è
// importabile sia da Metro (che lo bundla per l'app) sia da Node (che lo
// testa in CI, vedi server/test/textPatterns.test.js).
//
// Qui dentro NON vanno import di React, di componenti o di i18n: deve
// restare importabile da Node. L'unica dipendenza ammessa è l'elenco delle
// stazioni, anch'esso .mjs e senza dipendenze proprie.
import { STATIONS, cityOf, AMBIGUOUS_BARE_NAMES } from './trainStations.mjs';

/* ---------------------------------------------------------------
 * CERCO / VENDO
 * ------------------------------------------------------------- */

// Segnali di richiesta (l'utente CERCA qualcosa: nessun bene reale)
export const CERCO_RE = /\b(cerco|cercasi|compro|acquisto|mi\s+serve|sto\s+cercando)\b/;
// Segnali di offerta (l'utente ha un bene reale da dare)
export const VENDO_RE = /\b(vendo|cedo|rivendo|offro|metto\s+in\s+vendita|scambio)\b/;

/**
 * Deduce CERCO/VENDO dal testo. Ritorna null quando il testo non contiene
 * segnali: chi chiama deve lasciare la scelta all'utente invece di
 * indovinare, perché sbagliare qui inverte la direzione del denaro.
 *
 * Quando compaiono ENTRAMBI i segnali vince CERCO: è il caso meno dannoso.
 * Un CERCO pubblicato per errore è una richiesta senza bene reale dietro,
 * mentre un VENDO per errore dichiara di possedere un biglietto che non
 * esiste, e su quello gli altri utenti fanno offerte.
 */
export function guessCercoVendoFromText(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  const cerco = CERCO_RE.test(s);
  const vendo = VENDO_RE.test(s);
  if (cerco && !vendo) return 'CERCO';
  if (vendo && !cerco) return 'VENDO';
  if (cerco && vendo) return 'CERCO';
  return null;
}

/* ---------------------------------------------------------------
 * Estrazione dati da un biglietto/conferma incollati
 * ------------------------------------------------------------- */

export const DATE_ANY_RE = /\b(?:(\d{1,2})[/-](\d{1,2})[/-](\d{4})|(\d{4})[/-](\d{1,2})[/-](\d{1,2}))\b/;
export const DATE_TEXT_RE = new RegExp(String.raw`\b(\d{1,2})\s([A-Za-zÀ-ÿ]{3,})\s(\d{4})\b`, 'i');
export const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
export const FLIGHT_NO_RE = /\b([A-Z]{2})\s?(\d{2,4})\b/;
export const IATA_PAIR_RE = /\b([A-Z]{3})\s*(?:-|–|—|>|→|to|verso)\s*([A-Z]{3})\b/;
// `FR\s?\d` seguito da `\b` matchava una cifra sola, e su un numero vero
// ("FR9512") il confine di parola cadeva in mezzo alle cifre: nessun codice
// Frecciarossa con più di una cifra veniva riconosciuto come treno. Ora il
// numero è catturato per intero. Aggiunte anche le parole "treno"/"train":
// erano assenti, quindi "biglietto treno 8164" non contava come indizio
// ferroviario e poteva finire classificato come hotel.
export const TRAIN_KEYWORDS_RE = /\b(?:Trenitalia|Frecciarossa|Frecciargento|Frecciabianca|Italo|NTV|Intercity|Regionale|IC|FR\s?\d{1,5}|treno|train)\b/i;
export const PNR_RE = /\b(?:PNR|booking\s*reference|codice\s*(?:prenotazione|biglietto)|record\s*locator)\s*[:=]?\s([A-Z0-9]{5,8})\b/i;

// Parole che compaiono accanto a una tratta ma NON fanno parte del nome di
// una località. Senza questo filtro i gruppi erano `[A-Za-zÀ-ÿ .'-]+` avidi e
// si portavano dietro tutto ciò che seguiva: "da Milano a Roma prima classe"
// dava destinazione "Roma prima classe", e "vendo biglietto Milano - Roma
// seconda classe" dava partenza "vendo biglietto Milano". Quei valori
// finivano dritti nei campi Da/A del form.
const NOT_PLACE = '(?!(?:prima|seconda|terza|classe|business|standard|executive|economy|premium|bigliett\\w*|prenotazion\\w*|treno|volo|hotel|camera|ore|alle|del|dei|della|delle|euro|eur|posto|posti|carrozza|fila|vendo|cedo|cerco|offro|rivendo|andata|ritorno|solo)\\b)';
// Il \b iniziale impedisce di agganciare a metà parola: senza, il filtro
// veniva aggirato partendo da "iglietto".
const PLACE_WORD = `\\b${NOT_PLACE}[A-Za-zÀ-ÿ'’.-]{2,}`;
// Una località è 1 o 2 parole ("Roma", "Milano Centrale", "Reggio Calabria").
const ROUTE_PLACE = `${PLACE_WORD}(?:\\s+${PLACE_WORD}){0,1}`;

export const ROUTE_TEXT_RE = new RegExp(`\\b(?:da|from)\\s+(${ROUTE_PLACE})\\s+(?:a|to)\\s+(${ROUTE_PLACE})`, 'i');
export const ROUTE_ARROW_RE = new RegExp(`(${ROUTE_PLACE})\\s*(?:-|–|—|>|→)\\s*(${ROUTE_PLACE})`, 'i');

/* ---------------------------------------------------------------
 * Tratte riconosciute sull'elenco delle stazioni (whitelist)
 * ------------------------------------------------------------- */

// Le regex qui sopra restano una BLACKLIST: sanno solo quali parole NON sono
// località, quindi qualunque termine non previsto rientra ("Milano - Roma con
// supplemento" dava destinazione "Roma con") e un nome di città col trattino
// è indistinguibile da una tratta ("Reggio-Emilia" letto come Reggio→Emilia).
//
// Confrontare i candidati con l'elenco di città che l'app già usa per
// l'autocompletamento è invece una whitelist: alza il soffitto invece di
// spostarlo. Le regex restano come ripiego per le località fuori elenco.

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // trattini e apostrofi diventano spazi: così "Reggio-Emilia" e
    // "L'Aquila" si confrontano con le voci dell'elenco scritte per esteso
    .replace(/['’`\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Luoghi noti: sia le stazioni per esteso ("Milano — Centrale") sia le sole
// città ("Milano"). Dal più lungo al più corto, così "Milano Centrale" vince
// su "Milano" e "Reggio Emilia" non viene spezzata in "Reggio".
// Il nome restituito è quello canonico dell'elenco: chi scrive "milano
// centrale" a mano si ritrova il campo nello stesso formato prodotto
// dall'autocompletamento.
// I nomi ambigui (Ora, Fermo, Massa...) rientrerebbero da cityOf anche se in
// STATIONS compaiono solo nella forma estesa: vanno esclusi qui, altrimenti
// una frase normale diventa una tratta. Restano riconoscibili per nome
// completo ("Ora — Termeno").
const KNOWN_PLACES = [
  ...new Set([
    ...STATIONS,
    ...STATIONS.map(cityOf).filter((c) => !AMBIGUOUS_BARE_NAMES.has(normText(c))),
  ]),
]
  .map((name) => ({ name, norm: normText(name) }))
  .filter((p) => p.norm)
  .sort((a, b) => b.norm.length - a.norm.length);

// Insieme normalizzato, per riconoscere quando due "località" trovate dalle
// regex sono in realtà i due pezzi di UN solo nome ("Reggio" + "Emilia").
const KNOWN_PLACE_SET = new Set(KNOWN_PLACES.map((p) => p.norm));

// Fra due città consecutive può esserci SOLO un separatore di tratta perché
// la coppia conti come tale (il trattino qui è già stato normalizzato a
// spazio, quindi resta lo spazio vuoto o le preposizioni).
const GAP_IS_SEPARATOR_RE = /^\s*(?:>|→|a|to|verso)?\s*$/;

/**
 * Tratte riconosciute confrontando il testo con l'elenco delle stazioni.
 * @returns {{from:string,to:string}[]} nomi nella forma canonica dell'elenco
 */
export function findKnownRoutes(text) {
  const norm = normText(text);
  if (!norm) return [];

  // posizioni di tutte le città note, senza sovrapposizioni
  const hits = [];
  const taken = new Array(norm.length).fill(false);
  for (const city of KNOWN_PLACES) {
    const re = new RegExp(`(?:^|\\s)${city.norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g');
    let m;
    while ((m = re.exec(norm)) !== null) {
      const start = m.index + (m[0].length - city.norm.length);
      const end = start + city.norm.length;
      if (taken.slice(start, end).some(Boolean)) continue;
      for (let i = start; i < end; i++) taken[i] = true;
      hits.push({ ...city, start, end });
      re.lastIndex = end;
    }
  }
  hits.sort((a, b) => a.start - b.start);

  const routes = [];
  for (let i = 0; i + 1 < hits.length; i++) {
    const gap = norm.slice(hits[i].end, hits[i + 1].start);
    if (GAP_IS_SEPARATOR_RE.test(gap)) {
      routes.push({ from: hits[i].name, to: hits[i + 1].name });
    }
  }
  return routes;
}

/**
 * Estrae la tratta: prima sull'elenco delle stazioni, poi — solo se lì non
 * si trova nulla — con le regex, che coprono le località fuori elenco.
 * @returns {{from:string,to:string}|null}
 */
export function extractRoute(text) {
  const known = findKnownRoutes(text);
  if (known.length) return known[0];

  const src = String(text || '');
  const arrow = src.match(ROUTE_ARROW_RE);
  if (arrow) return acceptFallback(arrow[1], arrow[2]);
  const daA = src.match(ROUTE_TEXT_RE);
  if (daA) return acceptFallback(daA[1], daA[2]);
  return null;
}

// Le regex non sanno che "Reggio-Emilia" è UN nome: lo spezzano in
// Reggio→Emilia. Se i due capi rimessi insieme formano un luogo dell'elenco,
// non era una tratta e il ripiego va scartato — altrimenti annullerebbe il
// giudizio corretto della whitelist, che su quel testo aveva risposto
// "nessuna tratta" proprio perché aveva riconosciuto la città intera.
function acceptFallback(from, to) {
  const a = String(from || '').trim();
  const b = String(to || '').trim();
  if (!a || !b) return null;
  if (KNOWN_PLACE_SET.has(normText(`${a} ${b}`))) return null;
  return { from: a, to: b };
}

/* ---------------------------------------------------------------
 * Prezzo
 * ------------------------------------------------------------- */

// Un importo: interi con separatore delle migliaia opzionale e al massimo due
// decimali. La valuta può precederlo ("€ 45") o seguirlo ("45 €").
const AMOUNT = '[0-9]{1,3}(?:[.\\s][0-9]{3})*(?:[,.][0-9]{1,2})?|[0-9]+(?:[,.][0-9]{1,2})?';
const CURRENCY = '(?:€|\\beur\\b|\\beuro\\b)';

// La versione precedente era `(?:€|eur|euro)\s*([0-9](?:[,.][0-9]{1,2})?)`:
// la classe catturava UNA CIFRA SOLA. "€ 45" dava 4 e "€ 120,50" dava 1, e
// quel valore finiva dritto nel campo prezzo dell'annuncio — cioè nel campo
// su cui poggiano il tetto anti-bagarinaggio e il matching per budget.
// Non riconosceva nemmeno la forma "45 €", con la valuta dopo l'importo.
export const PRICE_RE = new RegExp(`${CURRENCY}\\s*(${AMOUNT})|(${AMOUNT})\\s*${CURRENCY}`, 'i');

/**
 * Estrae un prezzo dal testo e lo converte in numero, o null.
 *
 * La normalizzazione è qui e non in lib/number.js perché questo modulo deve
 * restare senza dipendenze (viene importato anche da Node in CI). Rispetto a
 * parseLocalizedNumber gestisce in più il caso "1.250" senza decimali, che
 * lì verrebbe letto come 1,25.
 */
export function extractPrice(text) {
  const m = String(text || '').match(PRICE_RE);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? '').trim();
  if (!raw) return null;

  let s = raw;
  const hasComma = s.includes(',');
  if (hasComma) {
    // formato italiano: i punti/spazi sono migliaia, la virgola è il decimale
    s = s.replace(/[.\s]/g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:[.\s]\d{3})+$/.test(s)) {
    // "1.250" / "1 250": solo migliaia, nessun decimale
    s = s.replace(/[.\s]/g, '');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------
 * Vettore
 * ------------------------------------------------------------- */

export const RYANAIR_NAME_RE = /\bRyanair\b/i;
export const FR_CODE_RE = /\bFR\s?\d{1,4}\b/i;

/**
 * "FR ####" è ambiguo: è il prefisso dei voli Ryanair MA anche quello dei
 * Frecciarossa. Prima bastava il codice per dedurre Ryanair, e un biglietto
 * "Frecciarossa FR 9512 Milano Roma" veniva intitolato "Volo Ryanair Milano
 * → Roma".
 *
 * Regola: il nome del vettore scritto per esteso decide; il solo codice vale
 * come volo unicamente se nel testo non compare alcun riferimento
 * ferroviario. Nel dubbio vince il treno, perché questa piattaforma tratta
 * treni e hotel — un volo non è nemmeno un tipo di annuncio pubblicabile.
 */
export function looksLikeRyanair(text) {
  const s = String(text || '');
  if (RYANAIR_NAME_RE.test(s)) return true;
  return FR_CODE_RE.test(s) && !TRAIN_KEYWORDS_RE.test(s);
}

/* ---------------------------------------------------------------
 * "Sembrano due biglietti in un solo annuncio"
 * ------------------------------------------------------------- */

// Una "tratta" è una coppia di luoghi separata da una freccia/trattino o
// dalle preposizioni a/to/verso.
//
// I separatori-parola richiedono spazi attorno: senza, la `a` veniva
// catturata DENTRO le parole comuni e qualunque descrizione italiana
// risultava piena di tratte inesistenti — su "vendo un biglietto per treno
// 8164 Milano Piacenza prima classe" ne trovava due, spezzando "biglietto"
// e "classe".
//
// Anche i luoghi sono delimitati (1-3 parole, niente cifre): prima il gruppo
// inghiottiva spazi a piacere e due tratte REALI separate da "e"
// ("Milano-Roma e Torino-Napoli") venivano contate come UNA. Il conteggio
// sbagliava in entrambe le direzioni.
const PLACE = "[A-Za-zÀ-ÿ'’.-]{2,}(?:\\s+[A-Za-zÀ-ÿ'’.-]{2,}){0,2}";
const ROUTE_SEP = '(?:\\s*(?:-{1,2}|—|–|>|→)\\s*|\\s+(?:a|to|verso)\\s+)';
export const ROUTE_COUNT_RE = new RegExp(`${PLACE}${ROUTE_SEP}${PLACE}`, 'gi');

export const TIME_COUNT_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
export const DATE_COUNT_RE = /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})\b/g;
export const HOTEL_WORD_RE = /\b(hotel|albergo|b&b|bb|bnb|ostello|resort|guesthouse)\b/gi;
export const TWO_TICKETS_RE = /\b(2|due)\s+bigliett/i;

/**
 * Conta i segnali grezzi presenti nel testo. Separata dalla decisione per
 * poter verificare i conteggi indipendentemente dalle soglie.
 */
export function countListingSignals(desc) {
  const text = String(desc || '').toLowerCase();
  return {
    routes: [...text.matchAll(ROUTE_COUNT_RE)].length,
    times: [...text.matchAll(TIME_COUNT_RE)].length,
    dates: [...text.matchAll(DATE_COUNT_RE)].length,
    hotels: [...text.matchAll(HOTEL_WORD_RE)].length,
    mentionsTwoTickets: TWO_TICKETS_RE.test(text),
  };
}

/**
 * Decide se la descrizione sembra contenere DUE biglietti/soggiorni.
 *
 * È solo un avviso: non innesca più la creazione automatica di un secondo
 * annuncio (creava due righe identiche, che il trigger antiduplicato a DB
 * rifiutava dopo aver già inserito la prima). Restando un avviso, un falso
 * positivo costa un messaggio di troppo, non un annuncio fantasma.
 *
 * @returns {{two:boolean, reasonKey:string|null, n:number}} reasonKey è la
 *   chiave i18n che il chiamante traduce (questo modulo non conosce l'i18n).
 */
export function detectTwoListings(desc, type) {
  const text = String(desc || '').toLowerCase();
  if (text.length < 10) return { two: false, reasonKey: null, n: 0 };

  const s = countListingSignals(text);
  const ty = String(type || '').toLowerCase();

  if (ty === 'train') {
    if (s.routes >= 2) return { two: true, reasonKey: 'reasonRoutes', n: s.routes };
    if (s.routes === 1 && s.times >= 3) return { two: true, reasonKey: 'reasonTimes', n: s.times };
  } else if (ty === 'hotel') {
    // Soglie più alte che per il treno: una normale conferma di prenotazione
    // (prenotato il / check-in / check-out / scadenza cancellazione gratuita)
    // cita già 4 date e la parola "hotel" più volte per UN SOLO soggiorno.
    if (s.dates >= 6) return { two: true, reasonKey: 'reasonDates', n: s.dates };
    if (s.hotels >= 3) return { two: true, reasonKey: 'reasonHotels', n: s.hotels };
  } else if (s.routes >= 2 || s.dates >= 4) {
    return { two: true, reasonKey: 'reasonMultiple', n: Math.max(s.routes, s.dates) };
  }

  if (s.mentionsTwoTickets) return { two: true, reasonKey: 'reasonTwoTickets', n: 2 };
  return { two: false, reasonKey: null, n: 0 };
}
