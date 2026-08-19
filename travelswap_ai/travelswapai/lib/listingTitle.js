// lib/listingTitle.js — pulizia titolo annuncio per la visualizzazione.
// Il prompt AI vieta di inserire il prezzo nel title (vedi
// server/src/ai/descriptionParse.js), quindi in condizioni normali non
// c'è nulla da tagliare qui: questo resta un ripulitore difensivo per
// titoli non generati da quel flusso (import Facebook, dati legacy) che
// potrebbero comunque avere il prezzo in coda.
// Il separatore con cui una tratta si mostra a chi legge.
//
// Nel trasporto dei dati ne convivono due, e va bene così: il prompt del
// server (server/src/ai/descriptionParse.js) impone l'ASCII "-->" perché è
// un formato che il modello riproduce senza sbavature, mentre una freccia
// Unicode gli esce ora in un modo ora in un altro. Il guaio è che quel
// formato di trasporto arrivava intatto fino allo schermo: un annuncio
// importato dalla descrizione compariva in vetrina come
// "Vendo treno Roma-->Milano solo andata", accanto a quelli scritti a mano
// che dicono "Roma → Milano". Stesso viaggio, due grafie, nella stessa
// schermata.
//
// Qui si converte al confine, dove il testo del server diventa testo
// dell'app. Tutti i lettori di tratte (splitRoute, ai/score.js,
// ai/chainMatch.js) accettano da sempre entrambe le grafie, quindi le righe
// già salvate con "-->" continuano a funzionare: cambia solo come si vedono.
export const SEPARATORE_TRATTA = " → ";

export function normalizzaSeparatoreTratta(s) {
  if (!s) return s;
  return String(s).replace(/\s*-->\s*/g, SEPARATORE_TRATTA);
}

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
