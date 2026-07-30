// Threat-modeling fase post-transazione (sezione A, punto 3, parte 2/2):
// prima non esisteva NESSUN equivalente di reportExchangeProblem per le
// catene a 3 — un solo partecipante disonesto danneggiava due persone
// innocenti senza che nessuna delle due avesse modo di segnalarlo. Chiama
// reportChainProblem() reale in lib/chains.js (chiama la RPC
// report_chain_problem), stesso approccio di offerReportProblem.test.js.
const CHAIN_ID = "44444444-4444-4444-8444-444444444444";
const ACCUSED_ID = "22222222-2222-4222-8222-222222222222";

const mockRpc = jest.fn(async (fn, params) => {
  if (fn === "report_chain_problem") {
    return {
      data: {
        id: "dispute-1",
        chain_id: params.p_chain_id,
        reporter_id: "11111111-1111-4111-8111-111111111111",
        accused_id: params.p_accused_id,
        reason: params.p_reason,
        resolved_at: null,
      },
      error: null,
    };
  }
  return { data: null, error: null };
});

jest.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args) => mockRpc(...args) },
}));

import { reportChainProblem } from "../lib/chains";

test("Contestazione catena a 3: segnala un problema con uno specifico altro partecipante", async () => {
  const dispute = await reportChainProblem(CHAIN_ID, ACCUSED_ID, "Non ho mai ricevuto il biglietto");

  expect(dispute.chain_id).toBe(CHAIN_ID);
  expect(dispute.accused_id).toBe(ACCUSED_ID);
  expect(dispute.reason).toBe("Non ho mai ricevuto il biglietto");
  expect(dispute.resolved_at).toBeNull();
  expect(mockRpc).toHaveBeenCalledWith("report_chain_problem", {
    p_chain_id: CHAIN_ID,
    p_accused_id: ACCUSED_ID,
    p_reason: "Non ho mai ricevuto il biglietto",
  });
});

test("Contestazione catena a 3: errore Postgres grezzo non arriva mai all'utente", async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: "Only completed chains can be reported" } });
  await expect(reportChainProblem(CHAIN_ID, ACCUSED_ID, "test")).rejects.toThrow(
    "Impossibile segnalare il problema"
  );
});
