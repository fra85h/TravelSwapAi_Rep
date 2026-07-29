// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 6 "Rami alternativi", step 25 "Prenotazione scaduta"): riaprendo
// Attività, l'app chiama in automatico release_my_stale_reservations()
// (AttivitaScreen.js) per liberare le proprie prenotazioni scadute.
//
// releaseMyStaleReservations() in lib/offers.js è dichiaratamente
// "best effort": nessun dato tornato, nessun errore mai propagato (il
// caricamento di Attività non deve bloccarsi se questa chiamata fallisce).
// Il test verifica esattamente questo contratto, con un mock completo del
// client Supabase — stesso approccio dei test precedenti.
//
// Fuori scope: il rilascio effettivo (listings tornano 'active', offerta
// 'cancelled') vive nella RPC — già corretta in questa sessione per una
// race condition (supabase/migrations/20260729120000_race_reservations_and_
// chain_locks.sql: rilegge e blocca la riga prima di scriverla, per non
// sovrascrivere un'offerta finalizzata nel frattempo da confirm_exchange_any
// in corso) — coperta da migrationsIntegrity.test.js e dalla checklist
// manuale, non da un mock.
const mockRpc = jest.fn();

jest.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args) => mockRpc(...args) },
}));

import { releaseMyStaleReservations } from "../lib/offers";

test("Prenotazione scaduta: il rilascio è best-effort, chiama la RPC senza mai lanciare", async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(releaseMyStaleReservations()).resolves.toBeUndefined();
  expect(mockRpc).toHaveBeenCalledWith("release_my_stale_reservations");

  // Anche se la chiamata di rete fallisce del tutto (promise rifiutata, non
  // solo un {error} nella risposta), non deve mai propagare: Attività non
  // deve bloccarsi al caricamento per questo.
  mockRpc.mockRejectedValueOnce(new Error("network error"));
  await expect(releaseMyStaleReservations()).resolves.toBeUndefined();
});
