// Passaggi post-accettazione: sono la mappa che l'utente segue per portare a
// termine la transazione, quindi le regole che contano sono "un solo passaggio
// attivo per volta" e "il turno attribuito a chi deve davvero muoversi".
import {
  buildTransactionSteps,
  STEP_ID,
  STEP_STATE,
  STEP_OWNER,
  PAYMENT_VARIANT,
} from "../lib/transactionSteps";

const swap = (over = {}) => ({
  status: "accepted",
  type: "swap",
  amount: null,
  currency: "EUR",
  iConfirmed: false,
  otherConfirmed: false,
  disputed: false,
  disputeReason: null,
  needsNameChange: false,
  ticketOperator: null,
  cancelReason: null,
  ...over,
});

const buy = (over = {}) => swap({ type: "buy", amount: 42, ...over });

const ids = (r) => r.steps.map((s) => s.id);
const byId = (r, id) => r.steps.find((s) => s.id === id);

describe("buildTransactionSteps", () => {
  test("handshake assente: nessun passaggio, nessun indice attivo", () => {
    expect(buildTransactionSteps(null)).toEqual({ steps: [], activeIndex: -1, remaining: 0 });
  });

  test("in uno scambio NON compare il passaggio del denaro", () => {
    // Regola di modello: uno scambio è biglietto contro biglietto, fra le due
    // parti non gira denaro. Un importo qui sarebbe un conguaglio inventato.
    expect(ids(buildTransactionSteps(swap()))).not.toContain(STEP_ID.PAYMENT);
  });

  test("in un acquisto il denaro c'è, ed è esterno all'app", () => {
    const r = buildTransactionSteps(buy());
    const pay = byId(r, STEP_ID.PAYMENT);
    expect(pay).toBeTruthy();
    expect(pay.params.variant).toBe(PAYMENT_VARIANT.EXTERNAL);
    expect(pay.params.amount).toBe(42);
  });

  test("un solo passaggio attivo per volta, in qualunque stato", () => {
    const cases = [
      buildTransactionSteps(swap()),
      buildTransactionSteps(swap({ needsNameChange: true, ticketOperator: "Trenitalia" })),
      buildTransactionSteps(buy({ needsNameChange: true })),
      buildTransactionSteps(swap({ iConfirmed: true })),
      buildTransactionSteps(swap({ status: "finalized", iConfirmed: true, otherConfirmed: true })),
      buildTransactionSteps(swap({ disputed: true, disputeReason: "biglietto mai ricevuto" })),
    ];
    for (const r of cases) {
      expect(r.steps.filter((s) => s.state === STEP_STATE.ACTIVE)).toHaveLength(1);
    }
  });

  test("il cambio nominativo compare solo se il biglietto è intestato", () => {
    expect(ids(buildTransactionSteps(swap()))).not.toContain(STEP_ID.NAME_CHANGE);
    const r = buildTransactionSteps(swap({ needsNameChange: true, ticketOperator: "Italo" }));
    expect(byId(r, STEP_ID.NAME_CHANGE).params.operator).toBe("Italo");
  });

  test("nello scambio il cambio nominativo tocca a entrambi", () => {
    // Ognuno reintesta a sé il biglietto che riceve: non è il turno di uno solo.
    const r = buildTransactionSteps(swap({ needsNameChange: true }));
    expect(byId(r, STEP_ID.NAME_CHANGE).owner).toBe(STEP_OWNER.BOTH);
  });

  test("senza ruolo noto il pagamento non attribuisce un turno a caso", () => {
    // Dire "tocca a te" a chi deve solo aspettare è peggio che non dirlo.
    expect(byId(buildTransactionSteps(buy()), STEP_ID.PAYMENT).owner).toBe(STEP_OWNER.UNKNOWN);
    expect(byId(buildTransactionSteps(buy(), { role: "buyer" }), STEP_ID.PAYMENT).owner).toBe(STEP_OWNER.ME);
    expect(byId(buildTransactionSteps(buy(), { role: "seller" }), STEP_ID.PAYMENT).owner).toBe(STEP_OWNER.OTHER);
  });

  test("il turno della conferma segue chi ha già confermato", () => {
    expect(byId(buildTransactionSteps(swap()), STEP_ID.CONFIRM).owner).toBe(STEP_OWNER.BOTH);
    expect(byId(buildTransactionSteps(swap({ iConfirmed: true })), STEP_ID.CONFIRM).owner).toBe(STEP_OWNER.OTHER);
    expect(byId(buildTransactionSteps(swap({ otherConfirmed: true })), STEP_ID.CONFIRM).owner).toBe(STEP_OWNER.ME);
  });

  test("confermando, i passaggi fuori app risultano superati", () => {
    // Non possiamo osservare un pagamento o una reintestazione avvenuti fuori
    // dall'app: chi conferma sta dichiarando che sono andati a buon fine.
    const r = buildTransactionSteps(buy({ needsNameChange: true, iConfirmed: true }));
    expect(byId(r, STEP_ID.PAYMENT).state).toBe(STEP_STATE.DONE);
    expect(byId(r, STEP_ID.NAME_CHANGE).state).toBe(STEP_STATE.DONE);
    expect(byId(r, STEP_ID.CONFIRM).state).toBe(STEP_STATE.ACTIVE);
  });

  test("prima della conferma i passaggi fuori app NON sono spuntati", () => {
    // Meglio un passaggio aperto troppo a lungo che uno spuntato per finta.
    const r = buildTransactionSteps(buy({ needsNameChange: true }));
    expect(byId(r, STEP_ID.PAYMENT).state).toBe(STEP_STATE.ACTIVE);
    expect(byId(r, STEP_ID.NAME_CHANGE).state).toBe(STEP_STATE.UPCOMING);
  });

  test("a transazione conclusa resta solo la valutazione", () => {
    const r = buildTransactionSteps(swap({ status: "finalized", iConfirmed: true, otherConfirmed: true }));
    expect(byId(r, STEP_ID.CONFIRM).state).toBe(STEP_STATE.DONE);
    expect(byId(r, STEP_ID.RATE).state).toBe(STEP_STATE.ACTIVE);
    expect(r.remaining).toBe(1);
  });

  test("voto già dato: nessun passaggio rimasto", () => {
    const r = buildTransactionSteps(
      swap({ status: "finalized", iConfirmed: true, otherConfirmed: true }),
      { alreadyRated: true }
    );
    expect(byId(r, STEP_ID.RATE).state).toBe(STEP_STATE.DONE);
    expect(r.remaining).toBe(0);
  });

  test("contestazione aperta: tutto il resto è bloccato", () => {
    // Il DB rifiuta comunque confirm_exchange con disputed_at valorizzato
    // (20260729150000): invitare all'azione sarebbe una promessa falsa.
    const r = buildTransactionSteps(swap({ disputed: true, disputeReason: "mai ricevuto" }));
    const dispute = byId(r, STEP_ID.DISPUTE);
    expect(dispute.state).toBe(STEP_STATE.ACTIVE);
    expect(dispute.params.reason).toBe("mai ricevuto");
    expect(byId(r, STEP_ID.CONFIRM).state).toBe(STEP_STATE.BLOCKED);
    expect(byId(r, STEP_ID.RATE).state).toBe(STEP_STATE.BLOCKED);
  });

  test("annullata: un solo passaggio terminale, col motivo", () => {
    const r = buildTransactionSteps(swap({ status: "cancelled", cancelReason: "listing_unavailable" }));
    expect(ids(r)).toEqual([STEP_ID.CANCELLED]);
    expect(r.steps[0].params.reason).toBe("listing_unavailable");
    expect(r.remaining).toBe(0);
  });

  test("il conteggio dei passaggi rimasti esclude quelli già fatti", () => {
    const r = buildTransactionSteps(swap({ needsNameChange: true }));
    // agreed (done) + nameChange + confirm + rate
    expect(r.steps).toHaveLength(4);
    expect(r.remaining).toBe(3);
  });
});
