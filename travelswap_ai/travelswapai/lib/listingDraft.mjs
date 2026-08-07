// La bozza di "Crea annuncio", intestata a chi la sta scrivendo.
//
// Prima stava sotto una chiave sola per tutto il dispositivo. Su un telefono
// condiviso — o semplicemente prestato — chi entrava dopo si trovava
// precompilati prezzo, tratta, date e descrizione di chi c'era prima.
//
// Perché la chiave intestata e non una pulizia all'uscita: la pulizia
// funziona solo se quel codice gira davvero. Una sessione scaduta, un token
// revocato o l'app chiusa a forza lo saltano, e la bozza resta lì per il
// prossimo che entra. La chiave legata all'identità non dipende da nessun
// percorso di pulizia: se sei un altro utente, stai leggendo un'altra chiave.
// In più ognuno si ritrova la propria bozza dopo un rientro, che con la
// pulizia si perdeva.

export const LEGACY_DRAFT_KEY = "@tsai:create_listing_draft";

/** La chiave di questo utente. null se non sappiamo ancora chi è. */
export function draftKey(userId) {
  const id = String(userId ?? "").trim();
  return id ? `${LEGACY_DRAFT_KEY}:${id}` : null;
}

/** La bozza dell'utente, o null. Una bozza illeggibile non è un guasto: si ignora. */
export async function readDraft(storage, userId) {
  const key = draftKey(userId);
  if (!key) return null;
  try {
    const raw = await storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Scrive la bozza. Senza utente non si scrive niente: meglio perdere una
 *  bozza che scriverla dove la leggerà qualcun altro. */
export async function writeDraft(storage, userId, form) {
  const key = draftKey(userId);
  if (!key) return false;
  try {
    await storage.setItem(key, JSON.stringify(form));
    return true;
  } catch {
    return false;
  }
}

export async function clearDraft(storage, userId) {
  const key = draftKey(userId);
  if (!key) return;
  try { await storage.removeItem(key); } catch { /* niente da fare, e niente da dire */ }
}

/**
 * La bozza vecchia, quella senza intestazione, viene BUTTATA e non migrata.
 *
 * Migrarla vorrebbe dire assegnarla al primo utente che apre l'app dopo
 * l'aggiornamento — che è esattamente la persona sbagliata nel caso che
 * stiamo chiudendo. Perdere una bozza in corso al momento dell'aggiornamento
 * costa molto meno che consegnarla a qualcun altro.
 */
export async function dropLegacyDraft(storage) {
  try { await storage.removeItem(LEGACY_DRAFT_KEY); } catch { /* idem */ }
}
