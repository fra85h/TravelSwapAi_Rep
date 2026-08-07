// "Dove è finito quello che ho appena salvato?"
//
// La stellina era l'unica azione dell'app che non dava nessun riscontro
// oltre a cambiare colore: la premevi, si riempiva, e finiva lì. Chi salva
// per la prima volta non ha modo di sapere che esiste una lista dei
// preferiti, quindi non la cerca e non ci arriva mai.
//
// Si dice UNA VOLTA SOLA, la prima. Dalla seconda in poi lo sa già, e le
// conferme si consumano: un "salvato!" a ogni stellina insegna soltanto a
// ignorarlo, e poi a ignorare anche quello che conta.
//
// Nessuno stato React qui dentro: chi salva è un'icona minuscola dentro una
// lista, chi mostra la striscia sta sopra il navigatore. Fra i due c'è
// questo, con lo stesso schema di lib/connectivity.js.

const ascoltatori = new Set();

/** Chiave del "già visto", intestata all'utente come la bozza: su un
 *  dispositivo condiviso il suggerimento vale per ognuno la sua prima volta. */
export function hintKey(userId) {
  const id = String(userId ?? "").trim();
  return id ? `@tsai:saved_hint_seen:${id}` : null;
}

/** true se questa persona non ha mai visto il suggerimento. */
export async function primoSalvataggio(storage, userId) {
  const key = hintKey(userId);
  if (!key) return false; // senza utente non si promette niente
  try {
    return (await storage.getItem(key)) == null;
  } catch {
    // Se non riusciamo a leggere il flag, meglio tacere che rischiare di
    // mostrarlo a ogni salvataggio.
    return false;
  }
}

export async function segnaHintMostrato(storage, userId) {
  const key = hintKey(userId);
  if (!key) return;
  try { await storage.setItem(key, "1"); } catch { /* al massimo si rivede una volta */ }
}

/** Chiede di mostrare la striscia. Chiamato dalla stellina. */
export function mostraHintPreferiti() {
  for (const cb of [...ascoltatori]) {
    try { cb(); } catch { /* un ascoltatore rotto non zittisce gli altri */ }
  }
}

export function subscribeSavedHint(cb) {
  if (typeof cb !== "function") return () => {};
  ascoltatori.add(cb);
  return () => ascoltatori.delete(cb);
}
