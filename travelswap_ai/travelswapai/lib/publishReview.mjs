// Cosa vale la pena dire un attimo prima di pubblicare.
//
// NON è un "sei sicuro?". Pubblicare è reversibile — un annuncio si mette in
// pausa in due tocchi — e una conferma davanti a un'azione innocua si
// consuma da sola: chi la incontra ogni volta impara a premere OK senza
// leggere, e quando arriva quella che conta davvero ("elimina", che è
// terminale) la salta con lo stesso automatismo.
//
// La regola per stare in questo elenco è una sola: la voce deve portare
// un'informazione che l'utente NON ha già davanti. "Manca il titolo" non ci
// sta — lo dice la validazione, con l'errore sotto al campo. "Il prezzo
// scenderà da solo" sì: quel toggle vive nelle opzioni avanzate, si attiva
// e ci si dimentica.
//
// Modulo .mjs e non logica dentro la schermata perché così è testabile senza
// bundler: la decisione su cosa mostrare è la parte che può sbagliare, il
// disegno del box no.

export const REVIEW = {
  NO_PHOTOS: "noPhotos",
  NO_TRUST: "noTrust",
  LOW_TRUST: "lowTrust",
  PRICE_HIGH: "priceHigh",
  DYNAMIC_PRICING: "dynamicPricing",
};

// Sotto questa soglia il punteggio è una cosa che l'utente vuole sapere
// PRIMA, non dopo: è il numero che vedrà chiunque guardi l'annuncio.
export const LOW_TRUST_THRESHOLD = 60;

/**
 * Numero vero, o null.
 *
 * Esiste per un motivo preciso: `Number(null)` è 0, e uno zero nato da un
 * campo assente qui non è un dettaglio — trasformerebbe "punteggio non
 * calcolato" in "punteggio 0%", cioè un avviso che dice una cosa falsa
 * all'utente. (Stesso trabocchetto già preso una volta sugli indici delle
 * catene: vale la pena scriverlo una volta e non ricascarci.)
 */
function numero(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} ctx
 * @param {number} ctx.photoCount            foto totali (già caricate + in attesa)
 * @param {number|null} ctx.trustScore       punteggio appena calcolato, null se non c'è
 * @param {{pct:number|null}|null} ctx.priceHint  avviso "prezzo alto", se presente
 * @param {boolean} ctx.dynamicPricingEnabled
 * @param {number|null} ctx.priceFloor       minimo del decadimento automatico
 * @returns {Array<{code:string, icon:string, params:object}>} vuoto = niente da dire
 */
export function publishReviewItems(ctx = {}) {
  const {
    photoCount = 0,
    trustScore = null,
    priceHint = null,
    dynamicPricingEnabled = false,
    priceFloor = null,
  } = ctx;

  const items = [];

  if ((numero(photoCount) ?? 0) <= 0) {
    items.push({ code: REVIEW.NO_PHOTOS, icon: "image-off-outline", params: {} });
  }

  const score = numero(trustScore);
  if (score === null) {
    // Nessun punteggio non è "punteggio basso": l'annuncio esce proprio
    // senza badge, ed è un'altra cosa da dire.
    items.push({ code: REVIEW.NO_TRUST, icon: "shield-alert-outline", params: {} });
  } else if (score < LOW_TRUST_THRESHOLD) {
    items.push({ code: REVIEW.LOW_TRUST, icon: "shield-alert-outline", params: { score: Math.round(score) } });
  }

  if (priceHint) {
    const pct = numero(priceHint.pct);
    items.push({
      code: REVIEW.PRICE_HIGH,
      icon: "cash-remove",
      params: pct === null ? {} : { pct },
    });
  }

  // Il caso più forte: è l'unica voce che riguarda qualcosa che succederà
  // DOPO, da sola, senza che nessuno tocchi più niente.
  if (dynamicPricingEnabled) {
    const floor = numero(priceFloor);
    items.push({
      code: REVIEW.DYNAMIC_PRICING,
      icon: "trending-down",
      params: floor === null ? {} : { floor },
    });
  }

  return items;
}
