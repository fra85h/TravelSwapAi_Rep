// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 6 "Rami alternativi", step 23 "Annullamento post-accettazione"):
// dopo aver accettato un'offerta, PRIMA che qualcuno confermi, una delle due
// parti annulla ("Annulla scambio"). Chiama cancelAcceptedOffer() reale in
// lib/offers.js (chiama la RPC cancel_accepted_offer_any), con un mock
// completo del client Supabase — stesso approccio dei test precedenti.
//
// Fuori scope qui: il rilascio effettivo degli annunci (listings.status
// torna 'active') vive dentro la RPC Postgres — un mock non lo esercita,
// resta coperto dalla checklist manuale. L'unica definizione
// (20260721190000_two_sided_exchange_confirmation.sql) lo fa con
// un'UPDATE ... WHERE status = 'reserved' unica, atomica: nessun rischio
// di leggere uno stato superato come nella race già corretta altrove
// (release_my_stale_reservations).
const OFFER_ID = "66666666-6666-4666-8666-666666666666";

const mockRpc = jest.fn(async (fn, params) => {
  if (fn === "cancel_accepted_offer_any") {
    return {
      data: {
        id: params.offer_id_text,
        status: "cancelled",
        owner_confirmed_at: null,
        proposer_confirmed_at: null,
      },
      error: null,
    };
  }
  return { data: null, error: null };
});

jest.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args) => mockRpc(...args) },
}));

import { cancelAcceptedOffer } from "../lib/offers";

test("Annullamento post-accettazione: prima di qualunque conferma", async () => {
  const cancelled = await cancelAcceptedOffer(OFFER_ID);

  // Stesso "atteso" della checklist manuale, step 23.
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.owner_confirmed_at).toBeNull();
  expect(cancelled.proposer_confirmed_at).toBeNull();
  expect(mockRpc).toHaveBeenCalledWith("cancel_accepted_offer_any", {
    offer_id_text: String(OFFER_ID),
    reason_text: null,
  });
});

// Threat-modeling fase post-transazione (sezione A, punto 2): l'annullamento
// ora registra sempre chi annulla e un motivo opzionale lato DB
// (cancel_accepted_offer_any(offer_id_text, reason_text)) — qui si verifica
// solo che il client passi il motivo quando fornito, non la logica DB
// (coperta da migrationsIntegrity.test.js).
test("Annullamento post-accettazione: passa il motivo quando fornito", async () => {
  await cancelAcceptedOffer(OFFER_ID, "L'altra persona non risponde più");

  expect(mockRpc).toHaveBeenCalledWith("cancel_accepted_offer_any", {
    offer_id_text: String(OFFER_ID),
    reason_text: "L'altra persona non risponde più",
  });
});
