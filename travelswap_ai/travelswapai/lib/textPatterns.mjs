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
// restare importabile da Node senza alcuna dipendenza.

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
