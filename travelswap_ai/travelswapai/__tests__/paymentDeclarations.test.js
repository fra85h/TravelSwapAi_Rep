// Dichiarazione del pagamento: l'app non custodisce denaro, qui si registra
// solo ciò che ciascuna parte dichiara di aver fatto fuori dall'app.
//
// Fuori scope: il doppio cieco e la derivazione del ruolo vivono TUTTI dentro
// le RPC Postgres (payment_declarations non è scrivibile direttamente, e in
// lettura la policy espone solo le proprie righe). Un mock simula le
// risposte, non esercita quella logica — stesso limite già dichiarato in
// rateTransaction.test.js. Qui si verifica il contratto lato client: cosa
// viene inviato, e come viene interpretato ciò che torna.
const OFFER_ID = 4242;

const mockRpc = jest.fn();

jest.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args) => mockRpc(...args) },
}));

import {
  declarePayment,
  getPaymentDeclarations,
  PAYMENT_METHODS,
} from "../lib/paymentDeclarations";

beforeEach(() => mockRpc.mockReset());

const row = (over = {}) => ({
  my_role: "buyer",
  mine_declared: false,
  mine_amount: null,
  mine_currency: "EUR",
  mine_method: null,
  mine_paid_at: null,
  other_declared: false,
  other_amount: null,
  other_method: null,
  other_paid_at: null,
  amounts_match: null,
  ...over,
});

test("i metodi ammessi sono un elenco chiuso, senza testo libero", () => {
  // Un campo libero qui diventerebbe il posto dove si scrivono IBAN e
  // numeri di telefono: dati che non vogliamo custodire.
  expect(PAYMENT_METHODS).toEqual([
    "bank_transfer", "paypal", "satispay", "revolut", "cash", "other",
  ]);
});

test("declarePayment invia i parametri nella forma attesa dalla RPC", async () => {
  mockRpc.mockResolvedValueOnce({
    data: [{ offer_id: OFFER_ID, role: "buyer", amount: 40, currency: "EUR", method: "paypal", paid_at: "2026-08-01" }],
    error: null,
  });
  const res = await declarePayment(OFFER_ID, { amount: 40, method: "paypal", paidAt: "2026-08-01" });
  expect(mockRpc).toHaveBeenCalledWith("declare_payment", {
    p_offer_id: OFFER_ID,
    p_amount: 40,
    p_method: "paypal",
    p_paid_at: "2026-08-01",
  });
  expect(res.role).toBe("buyer");
});

test("un rifiuto della RPC arriva all'utente, non viene inghiottito", async () => {
  // Es. dichiarazione su uno scambio, o data futura: sono errori che l'utente
  // deve vedere, altrimenti il bottone sembra non fare niente.
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: "Payment date cannot be in the future" } });
  await expect(declarePayment(OFFER_ID, { amount: 10, method: "cash", paidAt: "2099-01-01" }))
    .rejects.toThrow("Payment date cannot be in the future");
});

test("prima di dichiarare non si vede il contenuto altrui, ma si sa che c'è", async () => {
  // Doppio cieco: sapere quanto ha dichiarato l'altro permetterebbe di
  // allinearsi, e il dato perderebbe il suo unico pregio.
  mockRpc.mockResolvedValueOnce({ data: [row({ other_declared: true })], error: null });
  const d = await getPaymentDeclarations(OFFER_ID);
  expect(d.otherDeclared).toBe(true);
  expect(d.otherAmount).toBeNull();
  expect(d.otherMethod).toBeNull();
  expect(d.mineDeclared).toBe(false);
});

test("dichiarazioni concordi: amountsMatch true", async () => {
  mockRpc.mockResolvedValueOnce({
    data: [row({
      mine_declared: true, mine_amount: 40, mine_method: "paypal", mine_paid_at: "2026-08-01",
      other_declared: true, other_amount: 40, other_method: "paypal", other_paid_at: "2026-08-01",
      amounts_match: true,
    })],
    error: null,
  });
  const d = await getPaymentDeclarations(OFFER_ID);
  expect(d.amountsMatch).toBe(true);
  expect(d.otherAmount).toBe(40);
});

test("dichiarazioni discordi: amountsMatch false, non null", async () => {
  mockRpc.mockResolvedValueOnce({
    data: [row({
      mine_declared: true, mine_amount: 40,
      other_declared: true, other_amount: 30,
      amounts_match: false,
    })],
    error: null,
  });
  const d = await getPaymentDeclarations(OFFER_ID);
  expect(d.amountsMatch).toBe(false);
});

test("con una sola dichiarazione amountsMatch resta null, non false", async () => {
  // "Non lo sappiamo" non è "non coincidono": mostrarlo come discordanza
  // accuserebbe qualcuno sulla base del nulla.
  mockRpc.mockResolvedValueOnce({
    data: [row({ mine_declared: true, mine_amount: 40, amounts_match: null })],
    error: null,
  });
  const d = await getPaymentDeclarations(OFFER_ID);
  expect(d.amountsMatch).toBeNull();
});

test("errore in lettura: null, senza rompere la schermata", async () => {
  // Il blocco dichiarazione è accessorio: se non si legge, il resto dei
  // passaggi deve restare utilizzabile.
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: "Not a participant of this transaction" } });
  expect(await getPaymentDeclarations(OFFER_ID)).toBeNull();
});

test("il ruolo arriva dal DB: è ciò che permette di attribuire il turno", async () => {
  mockRpc.mockResolvedValueOnce({ data: [row({ my_role: "seller" })], error: null });
  const d = await getPaymentDeclarations(OFFER_ID);
  expect(d.myRole).toBe("seller");
});
