// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 4 "Chat e doppia conferma", step 14+15): account A conferma per
// primo ("Scambio avvenuto"), poi account B conferma anche lui. Chiama
// confirmExchange() reale in lib/offers.js (chiama la RPC
// confirm_exchange_any), con un mock completo del client Supabase — stesso
// approccio dei test precedenti.
//
// Fuori scope qui: la logica di finalizzazione vera e propria (lock,
// registrazione delle transactions, propagazione sold/swapped ai listing)
// vive dentro la RPC Postgres — un mock non la esercita, resta coperta da
// migrationsIntegrity.test.js e dalla checklist manuale. Step 13 (apertura
// chat/realtime) e step 16 (annuncio non più modificabile) sono verifiche
// di UI, non coperte da questo test.
const OFFER_ID = "44444444-4444-4444-8444-444444444444";

const mockRpc = jest.fn();

jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
  },
}));

import { confirmExchange } from "../lib/offers";

test("Doppia conferma: A conferma per primo, poi B — solo alla seconda si finalizza", async () => {
  // Step 14: A tocca "Scambio avvenuto". Atteso: status ancora 'accepted',
  // solo owner_confirmed_at valorizzato.
  mockRpc.mockResolvedValueOnce({
    data: {
      id: OFFER_ID,
      status: "accepted",
      owner_confirmed_at: new Date().toISOString(),
      proposer_confirmed_at: null,
    },
    error: null,
  });
  const afterA = await confirmExchange(OFFER_ID);

  expect(afterA.status).toBe("accepted");
  expect(afterA.owner_confirmed_at).toBeTruthy();
  expect(afterA.proposer_confirmed_at).toBeNull();

  // Step 15: B conferma anche lui. Atteso: status='finalized', entrambi i
  // confirmed_at valorizzati.
  mockRpc.mockResolvedValueOnce({
    data: {
      id: OFFER_ID,
      status: "finalized",
      owner_confirmed_at: afterA.owner_confirmed_at,
      proposer_confirmed_at: new Date().toISOString(),
    },
    error: null,
  });
  const afterB = await confirmExchange(OFFER_ID);

  expect(afterB.status).toBe("finalized");
  expect(afterB.owner_confirmed_at).toBeTruthy();
  expect(afterB.proposer_confirmed_at).toBeTruthy();

  expect(mockRpc).toHaveBeenCalledTimes(2);
  expect(mockRpc).toHaveBeenNthCalledWith(1, "confirm_exchange_any", { offer_id_text: OFFER_ID });
  expect(mockRpc).toHaveBeenNthCalledWith(2, "confirm_exchange_any", { offer_id_text: OFFER_ID });
});
