// lib/listingTitle.js — pulizia titolo annuncio per la visualizzazione.
// Il prompt AI vieta di inserire il prezzo nel title (vedi
// server/src/ai/descriptionParse.js), quindi in condizioni normali non
// c'è nulla da tagliare qui: questo resta un ripulitore difensivo per
// titoli non generati da quel flusso (import Facebook, dati legacy) che
// potrebbero comunque avere il prezzo in coda.
export function stripPriceFromTitle(s) {
  if (!s) return s;
  let out = String(s);
  // Richiede un marcatore di valuta (€/EUR) accanto alle cifre: senza
  // questo vincolo, QUALSIASI titolo che termina con 1-5 cifre veniva
  // troncato — un orario finale ("...delle 18:45") perdeva le ultime 2
  // cifre, un anno ("...estate 2026") spariva del tutto. Un prezzo vero
  // porta quasi sempre un simbolo di valuta; un numero finale senza
  // valuta è troppo ambiguo per essere tagliato alla cieca.
  out = out.replace(/\s*[-–—]?\s*(?:(?:€|\bEUR\b)\s*\d{1,5}(?:[\.,]\d{2})?|\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b))\s*$/i, "");
  out = out.replace(/\s*(?:prezzo|price)\s*[:\-]?\s*\d{1,5}(?:[\.,]\d{2})?\s*(?:€|\bEUR\b)?\s*$/i, "");
  return out.trim();
}
