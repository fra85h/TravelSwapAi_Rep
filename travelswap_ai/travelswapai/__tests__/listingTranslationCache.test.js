// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 8 "Funzionalità collaterali", step 37 "Traduzione on-demand"):
// riaprendo lo stesso annuncio, la seconda richiesta di traduzione deve
// arrivare dalla cache in-memory (nessuna nuova chiamata di rete).
//
// useListingTranslation() è un hook React (lib/useListingTranslation.js):
// serve renderHook di @testing-library/react-native invece di un mock
// diretto del client Supabase — qui non c'è Supabase in mezzo, la
// traduzione passa dal backend (GET /api/listings/:id/translate), quindi
// si mocka fetchJson (lib/backendApi.js).
const mockFetchJson = jest.fn();

jest.mock("../lib/backendApi", () => ({
  fetchJson: (...args) => mockFetchJson(...args),
}));

import { renderHook, act } from "@testing-library/react-native";
import { useListingTranslation } from "../lib/useListingTranslation";

test("Traduzione on-demand: la seconda richiesta usa la cache in-memory", async () => {
  mockFetchJson.mockResolvedValueOnce({
    title: "Room in Rome",
    description: "Nice room, quiet street",
    lang: "en",
    originalLang: "it",
    translated: true,
    titleTranslated: true,
    descriptionTranslated: true,
    cached: false,
  });

  const { result } = renderHook(() => useListingTranslation());

  let first;
  await act(async () => {
    first = await result.current.getTranslated("listing-1", "en");
  });

  expect(first.title).toBe("Room in Rome");
  expect(first.translated).toBe(true);
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
  expect(mockFetchJson).toHaveBeenCalledWith("/api/listings/listing-1/translate?lang=en", { method: "GET" });

  let second;
  await act(async () => {
    second = await result.current.getTranslated("listing-1", "en");
  });

  // Stesso "atteso" della checklist manuale, step 37: nessuna nuova
  // chiamata di rete, stesso risultato della prima volta.
  expect(second).toEqual(first);
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
});
