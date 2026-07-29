// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 5 "Valutazione", step 17+19+20): dopo la finalizzazione, account A
// vota, poi account B vota anche lui, poi A prova a rivotare con un valore
// diverso (deve essere rifiutato: voto immutabile).
//
// Chiama rateTransaction()/getUserRating() reali in lib/ratingsApi.js
// (chiamano le RPC rate_transaction/get_user_rating), con un mock completo
// del client Supabase — stesso approccio dei test precedenti.
//
// Fuori scope qui: il double-blind e l'immutabilità sono applicati TUTTI
// dentro le RPC Postgres (uniche a poter scrivere/leggere
// transaction_ratings, la tabella non è raggiungibile direttamente) — un
// mock simula solo le risposte, non esercita quella logica. Resta coperta
// dalla checklist manuale. Step 18 (B non vede ancora il voto di A prima
// che B stesso voti) e step 21 (stelle accanto al nome nel profilo) sono
// verifiche di UI/DB reale, non coperte qui.
const SELLER_A = "11111111-1111-4111-8111-111111111111";
const OFFER_ID = 4242;

const mockRpc = jest.fn();

jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
  },
}));

import { rateTransaction, getUserRating } from "../lib/ratingsApi";

test("Valutazione: A vota, B vota, il voto di A resta immutabile", async () => {
  // Step 17: A vota 5 stelle sulla transazione conclusa.
  mockRpc.mockResolvedValueOnce({
    data: [{ offer_id: OFFER_ID, stars: 5, created_at: new Date().toISOString() }],
    error: null,
  });
  const voteA = await rateTransaction(OFFER_ID, 5);
  expect(voteA.stars).toBe(5);
  expect(mockRpc).toHaveBeenCalledWith("rate_transaction", { p_offer_id: OFFER_ID, p_stars: 5 });

  // Step 19: B vota anche lui (4 stelle su A) — ora l'aggregato di A si
  // "rivela" (entrambe le parti hanno votato).
  mockRpc.mockResolvedValueOnce({
    data: [{ offer_id: OFFER_ID, stars: 4, created_at: new Date().toISOString() }],
    error: null,
  });
  const voteB = await rateTransaction(OFFER_ID, 4);
  expect(voteB.stars).toBe(4);

  mockRpc.mockResolvedValueOnce({
    data: [{ avg_stars: 4, ratings_count: 1 }],
    error: null,
  });
  const ratingOfA = await getUserRating(SELLER_A);
  expect(ratingOfA).toEqual({ avg: 4, count: 1 });
  expect(mockRpc).toHaveBeenCalledWith("get_user_rating", { p_user_id: SELLER_A });

  // Step 20: A prova a rivotare con un valore diverso (3 invece di 5): il DB
  // rifiuta (voto immutabile), rateTransaction deve rilanciare l'errore.
  mockRpc.mockResolvedValueOnce({
    data: null,
    error: { message: "Rating already given and cannot be changed" },
  });
  await expect(rateTransaction(OFFER_ID, 3)).rejects.toMatchObject({
    message: "Rating already given and cannot be changed",
  });
});
