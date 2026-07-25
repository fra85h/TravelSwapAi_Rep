// Verifica deterministica delle affermazioni "manca X" prodotte dall'AI.
//
// Caso reale che ha motivato questo file: un annuncio con descrizione
// "Vendo treno Palermo mazara 546 seconda classe per il 1 agosto 08:07/10:20"
// riceveva come spiegazione del punteggio "La descrizione non specifica il
// numero del treno e la classe del biglietto" — due dati che sono scritti
// nella descrizione, uno accanto all'altro.
//
// Il prompt conteneva già una regola vincolante contro questo errore, ma la
// regola stessa nominava "il numero del treno" e "la classe del biglietto"
// come esempi: il modello ha restituito esattamente quelle due voci. Gli
// esempi in un prompt orientano l'output anche quando servono a vietare un
// comportamento, quindi la regola scritta non basta e serve un controllo che
// non dipenda dal modello.
//
// Perché SOPPRIMERE e non correggere: CLAUDE.md chiede che il "perché" del
// punteggio sia sempre visibile, ma una spiegazione FALSA è peggio di nessuna
// spiegazione — manda l'utente a "sistemare" qualcosa che è già a posto, e gli
// fa credere che sia l'app a sbagliare (è esattamente quello che è successo).
// Non si riscrive la frase perché non si può sapere quale motivo VERO l'AI
// avrebbe dovuto dare al suo posto: inventarlo sarebbe lo stesso errore.

import { isKnownRailCity } from './heuristics.js';

/** Testo su cui l'AI ha giudicato: titolo + descrizione. */
function listingText(listing) {
  return [listing?.title, listing?.description].filter(Boolean).join(' \n ');
}

// ----------------------------------------------------------------------
// Tratta messa in dubbio
//
// computeTrustScore scarta già il flag IMPLAUSIBLE_ROUTE dell'AI quando
// origine e destinazione sono entrambe nell'allow-list delle città su rotaia.
// Quella soppressione però copriva SOLO il flag: la stessa identica obiezione
// scritta in prosa dentro 'textReason' passava intatta.
//
// Caso reale: tratta Palermo → Mazara, flag correttamente scartato (punteggio
// 90, non il tetto di 35), ma la spiegazione diceva comunque "la tratta
// Palermo → Mazara non è segnalata come valida per il treno". È una linea
// regionale che esiste, e l'allow-list lo sa: la frase contraddice la
// decisione che il sistema ha già preso.
//
// Le frasi arrivano nella lingua dell'utente (it/en/es), quindi i pattern
// coprono le tre lingue.
const ROUTE_MENTION_RE = /\b(tratta|percorso|collegamento|route|trayecto|recorrido|conexi[oó]n)\b/i;
const ROUTE_DOUBT_RE = new RegExp(
  [
    // italiano
    'non\\s+(?:è|e\')\\s+(?:segnalat|indicat|riconosciut|valid|percorribil|servit|copert|disponibil)\\w*',
    'non\\s+(?:risulta|esiste|sembra|pare|appare)',
    'potrebbe\\s+non\\s+essere',
    '(?:tratta|percorso|collegamento)\\s+(?:non\\s+valid|dubbi|incert|sospett)\\w*',
    'verificare\\s+se\\s+la\\s+tratta',
    // inglese
    'not\\s+(?:a\\s+)?(?:valid|recognized|recognised|served|listed|available)',
    'does\\s+not\\s+(?:appear|exist|seem)',
    // spagnolo
    'no\\s+(?:es|est[aá])\\s+(?:v[aá]lid|reconocid|indicad|disponible)\\w*',
    'no\\s+(?:figura|existe|parece)',
  ].join('|'),
  'i',
);

/**
 * Vero se la frase mette in dubbio una tratta che il sistema considera
 * percorribile. La prova è la stessa usata da computeTrustScore per scartare
 * il flag: entrambi i capi nell'allow-list delle città servite dal treno.
 */
function questionsAValidRoute(sentence, listing) {
  const tipo = String(listing?.type || '').toLowerCase();
  if (tipo !== 'train' && tipo !== 'treno') return false;
  if (!isKnownRailCity(listing?.origin) || !isKnownRailCity(listing?.destination)) return false;

  const s = String(sentence || '');
  if (!ROUTE_DOUBT_RE.test(s)) return false;
  // "non ci sono treni DIRETTI" è un'altra affermazione, e può essere vera:
  // l'allow-list dice che la tratta è percorribile sulla rete, non che si
  // faccia senza cambi. Non è nostro compito zittirla.
  if (/\b(dirett[oiae]|direct|directo)\b/i.test(s)) return false;
  // Il dubbio deve riguardare la tratta, non un altro dato: o la frase nomina
  // la tratta, o nomina entrambe le città.
  if (ROUTE_MENTION_RE.test(s)) return true;
  const citta = [listing.origin, listing.destination].map((c) => String(c || '').trim()).filter(Boolean);
  return citta.length === 2 && citta.every((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(s));
}

// Verbi con cui si afferma che un dato è assente.
const MISSING_CLAIM_RE =
  /(non\s+(?:specific|indic|riport|menzion|precis|chiaris|esplicit)\w*|non\s+(?:è|e'|sono)\s+(?:indicat|specificat|riportat|precisat)\w*|manca\w*|assent\w*|priv[oa]\s+di|omette|omess\w*)/i;

/** Numero di treno scritto nel testo, in una delle forme d'uso comune. */
function hasTrainNumber(text) {
  // "treno 546", "treno n. 546", "treno numero 546"
  if (/\btreno\s*(?:n(?:umero)?[.°]?\s*)?\d{2,5}\b/i.test(text)) return true;
  // sigle di categoria: FR 9512, IC 546, REG 12345, EC 40, ITL 8991
  if (/\b(?:fr|fa|fb|ic|icn|reg|rv|ec|en|itl|es)\s*\.?\s*\d{2,5}\b/i.test(text)) return true;

  // Numero isolato di 3-5 cifre: è quasi sempre il numero del treno, ma va
  // escluso ciò che numericamente gli somiglia — un anno e un importo.
  for (const m of text.matchAll(/\b(\d{3,5})\b/g)) {
    const n = m[1];
    if (/^(?:19|20)\d{2}$/.test(n)) continue;                     // anno
    const before = text.slice(Math.max(0, m.index - 2), m.index);
    const after = text.slice(m.index + n.length, m.index + n.length + 6);
    if (/[€$£]\s*$/.test(before)) continue;                       // "€546"
    if (/^\s*(?:€|\$|£|eur\b|euro\b)/i.test(after)) continue;     // "546 euro"
    return true;
  }
  return false;
}

function hasTicketClass(text) {
  return /\b(?:prima|seconda|1[ªa°]?|2[ªa°]?)\s*classe\b/i.test(text)
    || /\bclasse\s*(?:prima|seconda|1|2)\b/i.test(text)
    || /\b(?:business|standard|economy|premium|executive|first\s+class|second\s+class)\b/i.test(text);
}

function hasTime(text, listing) {
  if (/\b\d{1,2}[:.]\d{2}\b/.test(text)) return true;
  // startDate con una componente oraria diversa da mezzanotte
  const d = listing?.startDate ? new Date(listing.startDate) : null;
  if (d && Number.isFinite(d.getTime()) && /\d{2}:\d{2}/.test(String(listing.startDate))) return true;
  return false;
}

function hasPrice(text, listing) {
  if (Number(listing?.price) > 0) return true;
  return /\d\s*(?:€|eur\b|euro\b)/i.test(text) || /(?:€|\$|£)\s*\d/.test(text);
}

function hasDate(text, listing) {
  if (listing?.startDate) return true;
  if (/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/.test(text)) return true;
  return /\b\d{1,2}\s+(?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\w*/i.test(text);
}

function hasRoute(text, listing) {
  if (listing?.origin && listing?.destination) return true;
  if (listing?.location) return true;
  return false;
}

// Ogni voce: come l'AI la NOMINA quando la dichiara mancante, e come si
// verifica che in realtà ci sia.
const CLAIMABLE_ITEMS = [
  { id: 'numero_treno', named: /numero\s+(?:del\s+)?treno|codice\s+(?:del\s+)?treno|train\s+number/i, isPresent: (t) => hasTrainNumber(t) },
  { id: 'classe',       named: /\bclasse\b|\bclass\b/i,                                              isPresent: (t) => hasTicketClass(t) },
  { id: 'orario',       named: /\borari?o?\b|\bora\s+di\s+(?:partenza|arrivo)\b/i,                   isPresent: (t, l) => hasTime(t, l) },
  { id: 'prezzo',       named: /\bprezzo\b|\bcosto\b|\bimporto\b/i,                                  isPresent: (t, l) => hasPrice(t, l) },
  { id: 'data',         named: /\bdata\b|\bdate\b/i,                                                 isPresent: (t, l) => hasDate(t, l) },
  { id: 'tratta',       named: /\btratta\b|\bpercorso\b|\bdestinazione\b|\bpartenza\b/i,             isPresent: (t, l) => hasRoute(t, l) },
];

/**
 * Voci che una frase dichiara mancanti pur essendo presenti nell'annuncio.
 * Funzione pura: nessuna chiamata esterna, verificabile da sola.
 *
 * @param {string} sentence  frase prodotta dall'AI (textReason o suggestion)
 * @param {object} listing   l'annuncio valutato
 * @returns {string[]} id delle voci contraddette (vuoto se la frase regge)
 */
export function falseMissingClaims(sentence, listing) {
  const s = String(sentence || '');
  if (!s.trim()) return [];

  const contraddette = [];

  // Tratta messa in dubbio: si verifica sull'allow-list, non sul testo
  // dell'annuncio, quindi vale anche quando titolo e descrizione sono vuoti.
  if (questionsAValidRoute(s, listing)) contraddette.push('tratta_valida');

  if (MISSING_CLAIM_RE.test(s)) {
    const text = listingText(listing);
    if (text.trim()) {                        // senza testo non c'è confronto
      for (const item of CLAIMABLE_ITEMS) {
        if (item.named.test(s) && item.isPresent(text, listing)) contraddette.push(item.id);
      }
    }
  }

  return contraddette;
}

/**
 * La spiegazione del punteggio, se regge; null se afferma che manca un dato
 * che invece c'è. Basta UNA voce contraddetta: una frase che contiene
 * un'affermazione falsa non è mostrabile, e non si può ritagliarne la parte
 * buona senza riscriverla.
 */
export function reasonWithoutFalseClaims(reason, listing) {
  const bad = falseMissingClaims(reason, listing);
  if (!bad.length) return reason ?? null;
  console.warn(`[trustscore] textReason soppresso, contraddetto su: ${bad.join(', ')} — "${reason}"`);
  return null;
}

/**
 * I suggerimenti che non chiedono di aggiungere qualcosa che c'è già.
 * Qui si filtra voce per voce, perché ogni suggerimento è indipendente dagli
 * altri: gli altri restano utili.
 */
export function fixesWithoutFalseClaims(fixes, listing) {
  if (!Array.isArray(fixes)) return [];
  return fixes.filter((f) => {
    const testo = [f?.suggestion, f?.msg].filter(Boolean).join(' ');
    // "Aggiungere il numero del treno" non contiene un verbo di assenza ma
    // afferma la stessa cosa: chiedere di aggiungere un dato presente è
    // altrettanto sbagliato.
    const comeAssenza = /\b(aggiung\w*|inserisc\w*|specific\w*|indic\w*|precis\w*|complet\w*)\b/i.test(testo)
      ? `non specifica ${testo}`
      : testo;
    const bad = falseMissingClaims(comeAssenza, listing);
    if (bad.length) {
      console.warn(`[trustscore] suggerimento soppresso, contraddetto su: ${bad.join(', ')} — "${testo}"`);
      return false;
    }
    return true;
  });
}
