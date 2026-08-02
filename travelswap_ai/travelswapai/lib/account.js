// lib/account.js — cancellazione del proprio account.
//
// Passa dal backend e non da Supabase diretto: l'anonimizzazione richiede il
// service_role e la chiusura dell'accesso l'API di amministrazione, due cose
// che un client non deve poter fare. Qui c'è solo la chiamata e la traduzione
// dell'esito in qualcosa di comprensibile.
import { fetchJson } from "./backendApi";

/**
 * Cosa impedisce di cancellare adesso. Si legge PRIMA di mostrare il pulsante,
 * così l'utente sa già che deve chiudere uno scambio in corso invece di
 * scoprirlo con un rifiuto dopo aver confermato due volte.
 * Best effort: se la lettura fallisce si lascia procedere — sarà il server a
 * rifiutare, ed è comunque lui l'autorità.
 */
export async function getDeletionBlockers() {
  try {
    const r = await fetchJson("/api/account/deletion-blockers", { method: "GET" });
    return { openOffers: Number(r?.openOffers || 0), openChains: Number(r?.openChains || 0) };
  } catch (e) {
    console.log("[getDeletionBlockers]", e?.message || e);
    return null;
  }
}

/** Errore con una causa riconoscibile dalla schermata. */
export class AccountDeletionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Cancella l'account. Al ritorno la sessione non è più valida: chi chiama
 * deve fare logout e riportare l'utente alla schermata di accesso.
 */
export async function deleteMyAccount() {
  try {
    return await fetchJson("/api/account/delete", { method: "POST", body: {} });
  } catch (e) {
    const msg = String(e?.message || "");
    // 409 dal server: transazione o scambio a 3 ancora aperti.
    if (/in_progress|409/.test(msg)) {
      throw new AccountDeletionError("in_progress", msg);
    }
    // I dati sono già anonimi ma l'accesso non è stato chiuso: è uno stato a
    // metà, e va detto invece di lasciar credere che non sia successo nulla.
    if (/auth_close_failed/.test(msg)) {
      throw new AccountDeletionError("auth_close_failed", msg);
    }
    throw new AccountDeletionError("generic", msg);
  }
}
