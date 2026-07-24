// server/src/lib/messengerPublishOutcome.js
// Decide messaggio da mandare all'utente e se svuotare la sessione, a
// partire dal risultato di upsertListingFromFacebook. Isolata dal resto
// (nessuna chiamata a Facebook/DB) così da poter testare la regola senza
// mockare I/O — vedi test/messengerPublishOutcome.test.js. La sessione NON
// viene svuotata quando l'annuncio è scartato dal TrustScore, così l'utente
// può correggere testo/prezzo e riconfermare senza ripartire da zero.
export function decideMessengerPublishOutcome(result) {
  if (result?.skipped) {
    return {
      clearSession: false,
      message:
        "⚠️ Non ho pubblicato l'annuncio: il controllo automatico dei contenuti l'ha segnalato come poco " +
        "chiaro o poco affidabile (es. descrizione poco plausibile). Prova a correggere i dati e a confermare di nuovo.",
    };
  }
  return {
    clearSession: true,
    message:
      "✅ Fantastico! Il tuo annuncio è stato pubblicato con successo su TravelSwap 🎉\n" +
      "Grazie per aver condiviso — buona fortuna con lo scambio! ✈️🏨🚆",
  };
}
