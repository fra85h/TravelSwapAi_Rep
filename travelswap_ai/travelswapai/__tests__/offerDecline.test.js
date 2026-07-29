// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 6 "Rami alternativi", step 22 "Rifiuto"): account A rifiuta una
// proposta pending invece di accettarla. Chiama declineOffer() reale in
// lib/offers.js (chiama la RPC decline_offer_any), con un mock completo del
// client Supabase — stesso approccio dei test precedenti.
//
// decline_offer_any (supabase/migrations/20260718110001_offers_timeout.sql,
// unica definizione) tocca SOLO offers.status: un'offerta pending non ha
// mai riservato l'annuncio (solo accept_offer_any lo fa), quindi non c'è
// nulla da rilasciare — coerente con l'atteso della checklist manuale
// ("annuncio resta active").
const OFFER_ID = "55555555-5555-4555-8555-555555555555";

const mockRpc = jest.fn(async (fn, params) => {
  if (fn === "decline_offer_any") {
    return { data: { id: params.offer_id_text, status: "declined" }, error: null };
  }
  return { data: null, error: null };
});

jest.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args) => mockRpc(...args) },
}));

import { declineOffer } from "../lib/offers";

test("Rifiuto: A rifiuta una proposta pending", async () => {
  const declined = await declineOffer(OFFER_ID);

  // Stesso "atteso" della checklist manuale, step 22.
  expect(declined.status).toBe("declined");
  expect(mockRpc).toHaveBeenCalledWith("decline_offer_any", { offer_id_text: String(OFFER_ID) });
});
