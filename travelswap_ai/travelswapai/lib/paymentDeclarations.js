// lib/paymentDeclarations.js — cosa le due parti dichiarano di aver
// pagato/incassato fuori dall'app.
//
// L'app non custodisce denaro: negli acquisti il pagamento avviene
// direttamente fra le due persone. Questo modulo non lo gestisce e non lo
// verifica — registra soltanto ciò che ciascuno dichiara, per poter un
// giorno decidere sui numeri, e non a intuito, se un pagamento in custodia
// vale il suo costo.
//
// Non è un vincolo: nessun passaggio della transazione dipende da queste
// righe. La conferma reciproca resta l'unica cosa che chiude un acquisto.
import { supabase } from "./supabase";

/** Metodi ammessi. Elenco chiuso, identico al CHECK sulla tabella. */
export const PAYMENT_METHODS = [
  "bank_transfer",
  "paypal",
  "satispay",
  "revolut",
  "cash",
  "other",
];

/**
 * Dichiara (o corregge) il proprio pagamento.
 * @param {number|string} offerId
 * @param {{amount:number, method:string, paidAt:string}} decl  paidAt: 'YYYY-MM-DD'
 */
export async function declarePayment(offerId, { amount, method, paidAt }) {
  const { data, error } = await supabase.rpc("declare_payment", {
    p_offer_id: Number(offerId),
    p_amount: amount,
    p_method: method,
    p_paid_at: paidAt,
  });
  if (error) {
    console.log("[declarePayment]", error.message);
    throw new Error(error.message || "Impossibile registrare la dichiarazione");
  }
  const r = Array.isArray(data) ? data[0] : data;
  return r || null;
}

/**
 * Legge le dichiarazioni delle due parti. Il contenuto di quella altrui
 * arriva solo dopo aver fatto la propria (doppio cieco applicato dalla RPC,
 * non qui: il client non è il posto dove si fanno rispettare le regole).
 *
 * Ritorna null quando non c'è nulla da mostrare (offerta non di acquisto,
 * utente non partecipante): la schermata in quel caso non mostra il blocco.
 */
export async function getPaymentDeclarations(offerId) {
  const { data, error } = await supabase.rpc("get_payment_declarations", {
    p_offer_id: Number(offerId),
  });
  if (error) {
    console.log("[getPaymentDeclarations]", error.message);
    return null;
  }
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  return {
    myRole: r.my_role || null,
    mineDeclared: !!r.mine_declared,
    mineAmount: r.mine_amount ?? null,
    mineCurrency: r.mine_currency || "EUR",
    mineMethod: r.mine_method || null,
    minePaidAt: r.mine_paid_at || null,
    otherDeclared: !!r.other_declared,
    otherAmount: r.other_amount ?? null,
    otherMethod: r.other_method || null,
    otherPaidAt: r.other_paid_at || null,
    // null finché mancano entrambe le dichiarazioni: "non lo sappiamo" non è
    // "coincidono", e mostrarlo come una spunta verde sarebbe una bugia.
    amountsMatch: r.amounts_match === null || r.amounts_match === undefined ? null : !!r.amounts_match,
  };
}
