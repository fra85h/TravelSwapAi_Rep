// Lettura di un numero da variabile d'ambiente, con default e minimo.
//
// Nasce da due modi diversi di leggere la STESSA variabile che convivevano nel
// codice: `Number(process.env.X ?? 4)` e `Number(process.env.X || 4)`.
// Sembrano equivalenti e non lo sono:
//
//   X non impostata   ->  ?? dà 4,  || dà 4        uguali
//   X=""              ->  ?? dà 0 (NaN mancato),   || dà 4
//   X="0"             ->  ?? dà 0,   || dà 4
//   X="due"           ->  ?? dà NaN, || dà NaN
//
// Uno 0 o un NaN come limite di concorrenza è peggio di un valore sbagliato:
// un pool con limite 0 non avvia nessun worker e il lavoro non finisce mai.
// Qui il valore viene sempre riportato dentro un intervallo sensato.

/**
 * @param {string} name  nome della variabile d'ambiente
 * @param {number} fallback valore da usare se assente, vuota o non numerica
 * @param {{min?: number, max?: number}} [bounds]
 * @returns {number} intero dentro [min, max]
 */
export function envInt(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const parsed = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : Number(fallback);
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
