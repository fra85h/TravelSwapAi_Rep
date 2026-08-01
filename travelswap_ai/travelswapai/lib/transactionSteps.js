// lib/transactionSteps.js — i passaggi che restano da fare dopo che una
// proposta è stata accettata, derivati SOLO dallo stato dell'handshake.
//
// Perché un modulo a parte, e perché dati invece di JSX.
//
// Fino a qui l'app diceva all'utente com'era messa la transazione (una riga
// di stato in chat), non cosa doveva fare. I passaggi che rendono davvero
// reale uno scambio avvengono fuori dall'app — reintestazione del biglietto
// presso l'operatore, eventuale pagamento fra le parti — e nessuno li
// elencava: dopo aver confermato si tornava in chat senza sapere di chi
// fosse il turno.
//
// Sono DATI perché il giorno in cui i pagamenti passeranno dentro l'app
// (custodia con rilascio a consegna avvenuta) il passo "paga fuori dall'app"
// non va riscritto: cambia il suo `variant` da "external" a "escrow", cioè
// una riga qui dentro. Se i passaggi fossero scritti a mano nel JSX della
// schermata, quel giorno si riscriverebbe la schermata.
//
// Nessun testo per l'utente sta qui: il modulo restituisce identificatori e
// parametri, la schermata risolve le stringhe con i18n. Così resta puro e
// testabile, e le tre lingue restano allineate dal controllo di parità.

/** Stato di un passaggio nella sequenza. */
export const STEP_STATE = {
  DONE: "done",         // già avvenuto
  ACTIVE: "active",     // è il passaggio corrente, l'unico espanso
  UPCOMING: "upcoming", // verrà dopo
  BLOCKED: "blocked",   // non si può procedere (contestazione aperta)
};

/** A chi tocca muoversi. `unknown` quando il ruolo non è ricavabile. */
export const STEP_OWNER = {
  ME: "me",
  OTHER: "other",
  BOTH: "both",
  NOBODY: "nobody",
  UNKNOWN: "unknown",
};

/**
 * Identificatori dei passaggi. Sono anche le chiavi i18n
 * (transactionSteps.<id>.title / .body).
 */
export const STEP_ID = {
  AGREED: "agreed",
  PAYMENT: "payment",
  NAME_CHANGE: "nameChange",
  CONFIRM: "confirm",
  RATE: "rate",
  DISPUTE: "dispute",
  CANCELLED: "cancelled",
};

/**
 * Varianti del passaggio "denaro". Oggi esiste solo quella esterna: l'app
 * non custodisce fondi. `escrow` è il posto già pronto per quando li
 * custodirà — nessun'altra parte del codice va toccata per aggiungerlo.
 */
export const PAYMENT_VARIANT = {
  EXTERNAL: "external",
  ESCROW: "escrow",
};

/**
 * Costruisce la sequenza di passaggi.
 *
 * @param {object|null} handshake  Come lo restituisce getOfferHandshake():
 *   { status, type, amount, currency, iConfirmed, otherConfirmed,
 *     disputed, disputeReason, needsNameChange, ticketOperator, cancelReason }
 * @param {object}  [opts]
 * @param {"buyer"|"seller"|null} [opts.role]  Il MIO ruolo, quando chi chiama
 *   lo conosce (OfferDetailScreen sa se la proposta è ricevuta o inviata).
 *   L'handshake non lo espone: se manca, il passaggio del pagamento risulta
 *   di entrambi invece di attribuire un turno a caso — dire "tocca a te" a
 *   chi deve solo aspettare è peggio che non dirlo.
 * @param {string|null} [opts.otherName]  Nome dell'altra persona, per il copy.
 * @param {boolean} [opts.alreadyRated]  Ho già votato questa transazione: il
 *   voto è immutabile, quindi il passaggio della valutazione è chiuso.
 * @returns {{steps: Array, activeIndex: number, remaining: number}}
 */
export function buildTransactionSteps(handshake, opts = {}) {
  const role = opts.role === "buyer" || opts.role === "seller" ? opts.role : null;
  const otherName = opts.otherName || null;

  if (!handshake) return { steps: [], activeIndex: -1, remaining: 0 };

  const status = String(handshake.status || "").toLowerCase();
  const isBuy = handshake.type === "buy";

  // Annullata: un solo passaggio terminale. Non ha senso mostrare una
  // sequenza da percorrere per qualcosa che non esiste più.
  if (status === "cancelled") {
    return {
      steps: [step(STEP_ID.CANCELLED, STEP_STATE.BLOCKED, STEP_OWNER.NOBODY, {
        reason: handshake.cancelReason || null,
      })],
      activeIndex: 0,
      remaining: 0,
    };
  }

  const finalized = status === "finalized";
  const disputed = !!handshake.disputed;

  const steps = [];

  // 1) Proposta accettata. È il presupposto per essere qui, quindi è sempre
  //    già fatto: serve come punto di partenza visibile, non come compito.
  steps.push(step(STEP_ID.AGREED, STEP_STATE.DONE, STEP_OWNER.NOBODY, { otherName }));

  // 2) Denaro — SOLO negli acquisti. In uno scambio non gira denaro fra le
  //    due parti (biglietto contro biglietto): l'eventuale costo della
  //    reintestazione lo paga ognuno al proprio operatore, ed è parte del
  //    passaggio successivo, non un pagamento reciproco. Mostrare qui un
  //    importo per uno scambio significherebbe inventarsi un conguaglio che
  //    il modello non prevede.
  if (isBuy) {
    steps.push(step(STEP_ID.PAYMENT, null, ownerForPayment(role), {
      variant: PAYMENT_VARIANT.EXTERNAL,
      amount: handshake.amount ?? null,
      currency: handshake.currency || "EUR",
      otherName,
    }));
  }

  // 3) Cambio nominativo: solo se il biglietto è intestato. In uno scambio
  //    tocca a entrambi (ognuno reintesta a sé quello che riceve).
  if (handshake.needsNameChange) {
    steps.push(step(STEP_ID.NAME_CHANGE, null, isBuy ? ownerForPayment(role) : STEP_OWNER.BOTH, {
      operator: handshake.ticketOperator || null,
      isBuy,
    }));
  }

  // 4) Conferma reciproca: chiude la transazione. L'attribuzione del turno
  //    qui è l'informazione che manca di più oggi — chi ha già confermato
  //    non sa se deve fare altro o solo aspettare.
  steps.push(step(STEP_ID.CONFIRM, null, ownerForConfirm(handshake, finalized), {
    iConfirmed: !!handshake.iConfirmed,
    otherConfirmed: !!handshake.otherConfirmed,
    otherName,
  }));

  // 5) Valutazione: esiste solo a transazione conclusa.
  steps.push(step(STEP_ID.RATE, null, STEP_OWNER.ME, { otherName }));

  // Contestazione aperta: nessun passaggio può proseguire finché non è
  // risolta (lo impone anche il DB, confirm_exchange si ferma su
  // disputed_at — vedi 20260729150000). Si mostra il motivo in testa e si
  // spengono i passaggi rimasti, invece di invitare a un'azione che il
  // server rifiuterebbe.
  if (disputed) {
    const done = steps.filter((s) => s.state === STEP_STATE.DONE);
    const blocked = steps
      .filter((s) => s.state !== STEP_STATE.DONE)
      .map((s) => ({ ...s, state: STEP_STATE.BLOCKED }));
    const all = [
      ...done,
      step(STEP_ID.DISPUTE, STEP_STATE.ACTIVE, STEP_OWNER.BOTH, {
        reason: handshake.disputeReason || null,
        otherName,
      }),
      ...blocked,
    ];
    return { steps: all, activeIndex: done.length, remaining: blocked.length };
  }

  return resolveStates(steps, { finalized, handshake, alreadyRated: !!opts.alreadyRated });
}

/* ------------------------------------------------------------------ */

function step(id, state, owner, params) {
  return { id, state, owner, params: params || {} };
}

function ownerForPayment(role) {
  if (role === "buyer") return STEP_OWNER.ME;
  if (role === "seller") return STEP_OWNER.OTHER;
  return STEP_OWNER.UNKNOWN;
}

function ownerForConfirm(handshake, finalized) {
  if (finalized) return STEP_OWNER.NOBODY;
  if (handshake.iConfirmed && !handshake.otherConfirmed) return STEP_OWNER.OTHER;
  if (!handshake.iConfirmed && handshake.otherConfirmed) return STEP_OWNER.ME;
  return STEP_OWNER.BOTH;
}

/**
 * Assegna done/active/upcoming ai passaggi che non hanno già uno stato
 * fissato. Regola: un solo ACTIVE per volta — è tutto il punto della
 * schermata, se sono espansi due passaggi si torna a non sapere da dove
 * cominciare.
 *
 * Cosa si può osservare davvero: il pagamento e il cambio nominativo
 * avvengono fuori dall'app, quindi NON sappiamo se sono avvenuti. Si
 * considerano superati solo quando la conferma reciproca li ha resi
 * irrilevanti (chi conferma sta dichiarando che è andato tutto a buon fine).
 * Meglio un passaggio che resta aperto un po' troppo a lungo che uno spuntato
 * per finta.
 */
function resolveStates(steps, { finalized, handshake, alreadyRated }) {
  const iConfirmed = !!handshake.iConfirmed;

  const out = steps.map((s) => {
    if (s.state) return s;
    switch (s.id) {
      case STEP_ID.PAYMENT:
      case STEP_ID.NAME_CHANGE:
        // Confermando ho dichiarato che per me la transazione è avvenuta:
        // da lì in poi questi passaggi sono alle spalle.
        return { ...s, state: iConfirmed || finalized ? STEP_STATE.DONE : STEP_STATE.UPCOMING };
      case STEP_ID.CONFIRM:
        return { ...s, state: finalized ? STEP_STATE.DONE : STEP_STATE.UPCOMING };
      case STEP_ID.RATE:
        // Il voto è immutabile: una volta dato, il passaggio è chiuso.
        return { ...s, state: alreadyRated ? STEP_STATE.DONE : STEP_STATE.UPCOMING };
      default:
        return { ...s, state: STEP_STATE.UPCOMING };
    }
  });

  // Il primo passaggio non ancora fatto diventa quello attivo.
  const idx = out.findIndex((s) => s.state === STEP_STATE.UPCOMING);
  if (idx >= 0) out[idx] = { ...out[idx], state: STEP_STATE.ACTIVE };

  const remaining = out.filter((s) => s.state !== STEP_STATE.DONE).length;
  return { steps: out, activeIndex: idx, remaining };
}
