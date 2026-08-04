// lib/fareRules.js — dalla tariffa alla trasferibilità del nominativo.
//
// ⚠️ QUESTE SONO POLITICHE COMMERCIALI DI TERZI, NON REGOLE NOSTRE.
// Trenitalia e Italo cambiano condizioni di modifica, rimborso e cambio
// nominativo quando vogliono, e le condizioni differiscono per tariffa,
// canale di acquisto e tipo di treno. Questa tabella è una MAPPA DI
// DEFAULT, da rivedere periodicamente: sta qui, come dato, e non dentro un
// prompt AI, proprio perché deve essere modificabile senza toccare la
// logica né rieducare un modello.
//
// Conseguenza diretta sul comportamento: il risultato di queste regole non
// blocca NIENTE. Propone un valore, che il venditore vede e può correggere
// con la propria dichiarazione (name_change_source = 'declared', che ha la
// precedenza). Quando non riconosciamo la tariffa restituiamo UNKNOWN, che
// è una risposta legittima: tacere è più onesto che indovinare su un dato
// da cui dipende se un biglietto sarà utilizzabile o no.

export const NAME_CHANGE = {
  ALLOWED: "allowed",
  NOT_ALLOWED: "not_allowed",
  UNKNOWN: "unknown",
};

// Regole valutate NELL'ORDINE: la prima che combacia vince. Le tariffe più
// specifiche stanno quindi prima delle più generiche ("super economy" prima
// di "economy", altrimenti la seconda catturerebbe anche la prima).
const RULES = [
  // --- Trenitalia (Frecce / Intercity) ---
  { operator: /trenitalia|frecc|intercity/i, fare: /super\s*-?\s*economy/i, result: NAME_CHANGE.NOT_ALLOWED },
  { operator: /trenitalia|frecc|intercity/i, fare: /economy/i,              result: NAME_CHANGE.NOT_ALLOWED },
  { operator: /trenitalia|frecc|intercity/i, fare: /\bbase\b/i,             result: NAME_CHANGE.ALLOWED },
  { operator: /trenitalia|frecc|intercity/i, fare: /flex|modificabil/i,     result: NAME_CHANGE.ALLOWED },

  // --- Italo ---
  { operator: /italo|ntv/i, fare: /low\s*-?\s*cost/i,        result: NAME_CHANGE.NOT_ALLOWED },
  { operator: /italo|ntv/i, fare: /economy/i,                result: NAME_CHANGE.NOT_ALLOWED },
  { operator: /italo|ntv/i, fare: /flex|modificabil/i,       result: NAME_CHANGE.ALLOWED },

  // --- Senza operatore riconosciuto: si guarda solo il nome della tariffa.
  // Più debole, ma "Super Economy" vuol dire la stessa cosa ovunque.
  { operator: null, fare: /super\s*-?\s*economy|low\s*-?\s*cost|non\s*rimborsabil|non\s*modificabil/i, result: NAME_CHANGE.NOT_ALLOWED },
  { operator: null, fare: /flex|rimborsabil|modificabil/i, result: NAME_CHANGE.ALLOWED },
];

/**
 * Deduce la trasferibilità dalla tariffa. Non lancia mai e non inventa:
 * qualunque input non riconosciuto torna UNKNOWN.
 *
 * @param {string|null} fareType tariffa come scritta sul biglietto
 * @param {string|null} operator operatore, se noto (restringe la regola)
 * @returns {"allowed"|"not_allowed"|"unknown"}
 */
export function nameChangeFromFare(fareType, operator) {
  const fare = String(fareType || "").trim();
  if (!fare) return NAME_CHANGE.UNKNOWN;
  const op = String(operator || "").trim();

  for (const rule of RULES) {
    if (rule.operator && !(op && rule.operator.test(op))) continue;
    if (rule.fare.test(fare)) return rule.result;
  }
  return NAME_CHANGE.UNKNOWN;
}

/**
 * Converte l'esito in ciò che si salva sull'annuncio.
 * `declared` (la dichiarazione del venditore) vince sempre sulla deduzione:
 * lui il biglietto ce l'ha davanti, noi no.
 *
 * @returns {{ allowed: boolean|null, source: "declared"|"fare"|null }}
 */
export function resolveNameChange({ declared, fareType, operator }) {
  if (declared === true || declared === false) {
    return { allowed: declared, source: "declared" };
  }
  const guess = nameChangeFromFare(fareType, operator);
  if (guess === NAME_CHANGE.ALLOWED) return { allowed: true, source: "fare" };
  if (guess === NAME_CHANGE.NOT_ALLOWED) return { allowed: false, source: "fare" };
  return { allowed: null, source: null };
}
