// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 8 "Funzionalità collaterali", step 38 "Stima prezzo AI"): in
// creazione annuncio, tocca "Analisi prezzo con AI" → deve proporre un
// numero sensato per la tratta/data.
//
// Nota importante: nonostante l'etichetta, questa NON è una vera analisi
// AI — è un calcolo deterministico locale basato solo sulla durata
// (screens/CreateListingScreen.js: "Simulazione di analisi AI locale"),
// diverso dal pulsante con LO STESSO testo "Analisi prezzo con AI" in
// ListingDetailScreen (usePriceCheck), che invece chiama davvero il
// backend. Estratto qui in lib/priceSuggestion.js (prima viveva solo
// dentro lo screen) per poterlo testare senza montare l'intera schermata;
// il parsing delle date resta nello screen, immutato.
import { suggestListingPrice } from "../lib/priceSuggestion";

test("Stima prezzo: treno, durata nota -> ore * 12€, arrotondato a 5", () => {
  const suggestion = suggestListingPrice({
    type: "train",
    departDate: new Date("2026-08-05T09:00:00Z"),
    arriveDate: new Date("2026-08-05T12:30:00Z"), // 3h30 -> arrotondato a 4h
  });

  // 4h * 12€ = 48 -> arrotondato ai 5€ più vicini = 50.
  expect(suggestion).toBe(50);
});

test("Stima prezzo: hotel, notti note -> notti * 80€, con tetto a 400", () => {
  const suggestion = suggestListingPrice({
    type: "hotel",
    checkInDate: new Date("2026-08-05"),
    checkOutDate: new Date("2026-08-12"), // 7 notti
  });

  // 7 notti * 80€ = 560 -> oltre il tetto di 400.
  expect(suggestion).toBe(400);
});

test("Stima prezzo: senza date valide usa il default (2h treno / 1 notte hotel)", () => {
  const train = suggestListingPrice({ type: "train", departDate: null, arriveDate: null });
  // 2h default * 12€ = 24 -> arrotondato ai 5€ più vicini = 25.
  expect(train).toBe(25);

  const hotel = suggestListingPrice({ type: "hotel", checkInDate: null, checkOutDate: null });
  // 1 notte default * 80€ = 80, già multiplo di 5, tetto minimo 40 non tocca.
  expect(hotel).toBe(80);
});
