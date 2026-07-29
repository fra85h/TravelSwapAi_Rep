// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 3 "Proposta e accettazione", step 9+11): account B propone un
// acquisto sull'annuncio di A, poi A accetta. Chiama le funzioni reali
// dietro quei bottoni — createOfferBuy() e acceptOffer() in lib/offers.js
// (non esiste una route server per le offerte: il client scrive/chiama RPC
// direttamente su Supabase) — con un mock completo del client, stesso
// approccio di listingPublish.test.js.
//
// Fuori scope qui: la logica di accettazione vera e propria (lock, calcolo
// reservation_expires_at, declino delle altre proposte pending, stato degli
// annunci) vive TUTTA dentro la RPC Postgres accept_offer_any — un mock non
// la esercita, resta coperta solo da migrationsIntegrity.test.js e dalla
// checklist manuale.
const mockBuyerB = "22222222-2222-4222-8222-222222222222";
const LISTING_ID = "33333333-3333-4333-8333-333333333333";

const mockRpc = jest.fn(async (fn, params) => {
  if (fn === "accept_offer_any") {
    return {
      data: {
        id: params.offer_id_text,
        status: "accepted",
        reservation_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      error: null,
    };
  }
  return { data: null, error: null };
});

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } }, error: null }),
    },
    from: () => ({
      insert: (rows) => ({
        select: () => ({
          single: async () => ({ data: { id: "fake-offer-id-0001", ...rows[0] }, error: null }),
        }),
      }),
    }),
    rpc: (...args) => mockRpc(...args),
  },
}));

import { createOfferBuy, acceptOffer } from "../lib/offers";

test("Proposta e accettazione: B propone un acquisto, A accetta", async () => {
  const offer = await createOfferBuy(LISTING_ID, { amount: 45, currency: "EUR" });

  // Stesso "atteso" della checklist manuale, step 9.
  expect(offer.status).toBe("pending");
  expect(offer.type).toBe("buy");
  expect(offer.to_listing_id).toBe(LISTING_ID);
  expect(offer.proposer_id).toBe(mockBuyerB);
  expect(offer.amount).toBe(45);

  const accepted = await acceptOffer(offer.id);

  // Stesso "atteso" della checklist manuale, step 11.
  expect(accepted.status).toBe("accepted");
  expect(new Date(accepted.reservation_expires_at).getTime()).toBeGreaterThan(Date.now());
  expect(mockRpc).toHaveBeenCalledWith("accept_offer_any", { offer_id_text: String(offer.id) });
});
