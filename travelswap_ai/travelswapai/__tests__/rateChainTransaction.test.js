// Threat-modeling fase post-transazione (sezione A, punto 3, parte 1/2):
// rate_transaction leggeva solo da offers, quindi uno scambio a 3
// completato non era mai valutabile (confirm_chain_participant scrive solo
// in transactions, mai in offers). Decisione presa con l'utente: 3
// valutazioni indipendenti a coppia, stesso doppio cieco dei 1:1 — qui A
// vota B, poi B vota A, poi A prova a rivotare con un valore diverso
// (rifiutato, voto immutabile). Stesso approccio di rateTransaction.test.js:
// chiama rateChainTransaction()/myRatingForChain() reali in
// lib/ratingsApi.js, mock completo del client Supabase.
const PARTICIPANT_A = "11111111-1111-4111-8111-111111111111";
const PARTICIPANT_B = "22222222-2222-4222-8222-222222222222";
const CHAIN_ID = "33333333-3333-4333-8333-333333333333";

const mockRpc = jest.fn();

jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
  },
}));

import { rateChainTransaction, myRatingForChain, getUserRating } from "../lib/ratingsApi";

test("Valutazione catena a 3: A vota B, l'aggregato di B si rivela, A non può rivotare diverso", async () => {
  mockRpc.mockResolvedValueOnce({
    data: [{ chain_id: CHAIN_ID, rated_id: PARTICIPANT_B, stars: 5, created_at: new Date().toISOString() }],
    error: null,
  });
  const voteAonB = await rateChainTransaction(CHAIN_ID, PARTICIPANT_B, 5);
  expect(voteAonB.stars).toBe(5);
  expect(mockRpc).toHaveBeenCalledWith("rate_chain_transaction", {
    p_chain_id: CHAIN_ID,
    p_rated_id: PARTICIPANT_B,
    p_stars: 5,
  });

  // B non ha ancora votato A: il voto di A su B resta nascosto (double-blind
  // via SQL, non esercitato dal mock — qui si verifica solo il passaggio).
  mockRpc.mockResolvedValueOnce({ data: null, error: null });
  const myVote = await myRatingForChain(CHAIN_ID, PARTICIPANT_B);
  expect(myVote).toBeNull();
  expect(mockRpc).toHaveBeenCalledWith("my_rating_for_chain", { p_chain_id: CHAIN_ID, p_rated_id: PARTICIPANT_B });

  // B vota anche lui A: ora l'aggregato di B si rivela.
  mockRpc.mockResolvedValueOnce({
    data: [{ avg_stars: 5, ratings_count: 1 }],
    error: null,
  });
  const ratingOfB = await getUserRating(PARTICIPANT_B);
  expect(ratingOfB).toEqual({ avg: 5, count: 1 });

  // A prova a rivotare B con un valore diverso: il DB rifiuta (immutabile),
  // rateChainTransaction deve rilanciare come errore amichevole (non il
  // messaggio Postgres grezzo — stesso fix di PR #211).
  mockRpc.mockResolvedValueOnce({
    data: null,
    error: { message: "Rating already given and cannot be changed" },
  });
  await expect(rateChainTransaction(CHAIN_ID, PARTICIPANT_B, 1)).rejects.toThrow(
    "Impossibile registrare la valutazione"
  );
});
