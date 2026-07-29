// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 8 "Funzionalità collaterali", step 38 "Stima prezzo AI") — parte
// lato client della vera AI aggiunta in creazione annuncio (prima era solo
// una formula locale, vedi priceSuggestion.test.js): POST
// /api/listings/price-suggest su una bozza senza ancora un listing.id.
//
// usePriceSuggestAI() è un hook React (come useListingTranslation): si
// mocka fetchJson (lib/backendApi.js) e si usa renderHook, non un mock
// diretto del client Supabase (qui non c'è Supabase in mezzo).
const mockFetchJson = jest.fn();

jest.mock("../lib/backendApi", () => ({
  fetchJson: (...args) => mockFetchJson(...args),
}));

import { renderHook, act } from "@testing-library/react-native";
import { usePriceSuggestAI } from "../lib/usePriceSuggestAI";

test("Stima prezzo AI (creazione): propone un prezzo con spiegazione", async () => {
  mockFetchJson.mockResolvedValueOnce({
    available: true,
    suggestedPrice: 55,
    explanation: "Frecciarossa in alta velocità, tratta breve: prezzo in linea con il mercato.",
  });

  const { result } = renderHook(() => usePriceSuggestAI());

  let res;
  await act(async () => {
    res = await result.current.suggestPriceAI(
      { type: "train", routeFrom: "Roma", routeTo: "Milano", departAt: "2026-08-05T09:00:00Z", arriveAt: "2026-08-05T12:30:00Z" },
      "it"
    );
  });

  expect(res.available).toBe(true);
  expect(res.suggestedPrice).toBe(55);
  expect(mockFetchJson).toHaveBeenCalledWith("/api/listings/price-suggest", {
    method: "POST",
    body: { type: "train", routeFrom: "Roma", routeTo: "Milano", departAt: "2026-08-05T09:00:00Z", arriveAt: "2026-08-05T12:30:00Z", locale: "it" },
  });
});

test("Stima prezzo AI (creazione): se il backend non è disponibile, torna available=false", async () => {
  mockFetchJson.mockRejectedValueOnce(new Error("rate_limited"));

  const { result } = renderHook(() => usePriceSuggestAI());

  let res;
  await act(async () => {
    res = await result.current.suggestPriceAI({ type: "hotel", location: "Roma" }, "it");
  });

  // Il chiamante (analyzePriceAI in CreateListingScreen) usa questo per
  // decidere se ricadere sulla formula locale in lib/priceSuggestion.js.
  expect(res.available).toBe(false);
});
