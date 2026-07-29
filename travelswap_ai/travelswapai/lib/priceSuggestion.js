// lib/priceSuggestion.js — suggerimento di prezzo in creazione annuncio.
//
// Il pulsante dice "Analisi prezzo con AI" ma NON chiama nessuna AI: è un
// calcolo deterministico basato solo sulla durata (notti per hotel, ore di
// viaggio per treno). Stesso identico testo del pulsante "Analisi prezzo
// con AI" in ListingDetailScreen (usePriceCheck/checkPrice), che invece
// chiama davvero il backend (GET /api/listings/:id/price-check) — due
// funzionalità diverse dietro la stessa etichetta.
//
// Il parsing delle date resta nello screen (parseISODate/parseISODateTime,
// più severi di un semplice `new Date()`): qui arrivano già Date o null.
export function suggestListingPrice({ type, checkInDate, checkOutDate, departDate, arriveDate }) {
  if (type === "hotel") {
    const nights = (checkInDate && checkOutDate)
      ? Math.max(1, Math.round((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24)))
      : 1;
    const basePerNight = 80; // eur
    return round5(clamp(nights * basePerNight, 40, 400));
  }
  const hours = (departDate && arriveDate)
    ? Math.max(1, Math.round((arriveDate - departDate) / (1000 * 60 * 60)))
    : 2;
  const perHour = 12; // eur
  return round5(clamp(hours * perHour, 10, 120));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round5(n) {
  return Math.round(n / 5) * 5;
}
