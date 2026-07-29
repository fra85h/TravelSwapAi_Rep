// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 6 "Rami alternativi", step 24 "Contestazione"): una delle due parti
// segnala un problema su una prenotazione accettata ("biglietto non
// ricevuto", ecc.). Chiama reportExchangeProblem() reale in lib/offers.js
// (chiama la RPC report_exchange_problem), con un mock completo del client
// Supabase — stesso approccio dei test precedenti.
//
// Fuori scope qui: la parte "blocca la conferma finché non si risolve" NON
// è verificabile da un mock (vive, o dovrebbe vivere, dentro
// confirm_exchange_any) — vedi nota importante sotto.
const OFFER_ID = "77777777-7777-4777-8777-777777777777";

const mockRpc = jest.fn(async (fn, params) => {
  if (fn === "report_exchange_problem") {
    return {
      data: {
        id: params.offer_id_text,
        status: "accepted",
        disputed_at: new Date().toISOString(),
        dispute_reason: params.reason_text,
      },
      error: null,
    };
  }
  return { data: null, error: null };
});

jest.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args) => mockRpc(...args) },
}));

import { reportExchangeProblem } from "../lib/offers";

test("Contestazione: segnala un problema su una prenotazione accettata", async () => {
  const disputed = await reportExchangeProblem(OFFER_ID, "Biglietto non ricevuto");

  // Stesso "atteso" della checklist manuale, step 24 (la parte "resta
  // contestata"): status invariato (accepted), disputed_at valorizzato.
  expect(disputed.status).toBe("accepted");
  expect(disputed.disputed_at).toBeTruthy();
  expect(disputed.dispute_reason).toBe("Biglietto non ricevuto");
  expect(mockRpc).toHaveBeenCalledWith("report_exchange_problem", {
    offer_id_text: String(OFFER_ID),
    reason_text: "Biglietto non ricevuto",
  });
});

// NON testato qui (richiede un DB reale): la checklist manuale aspetta che
// "Prova a confermare da entrambi i lati: deve restare bloccato finché non
// risolvete". Era un bug reale — nessuna versione di confirm_exchange_any
// controllava offers.disputed_at prima di finalizzare — corretto in
// supabase/migrations/20260729150000_confirm_exchange_blocks_on_dispute.sql
// (regression test statico in server/test/migrationsIntegrity.test.js).
// Non replicato qui: la logica vive tutta nella RPC, un mock non la
// eserciterebbe davvero.
