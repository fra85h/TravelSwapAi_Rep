// lib/number.js

// Converte un prezzo in formato libero (IT o EN) in un numero finito, o
// null se non parseabile. `.replace(',', '.')` da solo (usato in più punti
// del progetto) sostituisce solo la PRIMA virgola: un prezzo in formato
// italiano con separatore delle migliaia, es. "1.234,56", diventava
// "1.234.56" -> Number(...) = NaN. Gestisce sia "45,50" (decimale IT) sia
// "1.234,56" (migliaia + decimale IT) sia "1234.56" (già in formato numerico).
export function parseLocalizedNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }

  s = s.replace(/[^\d.-]/g, '');
  // Number("") vale 0 in JS, non NaN: senza questo controllo un testo senza
  // cifre (es. "abc", dopo lo strip diventa "") sarebbe tornato 0 invece di
  // null, spacciando "nessun numero trovato" per "prezzo zero".
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
