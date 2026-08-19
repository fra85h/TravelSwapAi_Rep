// Dove va la prossima foto.
//
// La schermata di modifica calcolava il posto della nuova foto dal CONTEGGIO
// di quelle esistenti. Con due foto (posizioni 0 e 1), cancellando la prima
// ne resta una in posizione 1 mentre il conteggio dice "1": la foto nuova
// finiva sopra un posto già occupato.
//
// Prima l'effetto era silenzioso ma reale — due foto sulla stessa posizione,
// e quale facesse da copertina lo decideva l'ordine in cui il database
// restituiva le righe, cioè cambiava da una lettura all'altra. Da quando
// (listing_id, position) è unico (20260819100000), quel caricamento verrebbe
// rifiutato: il difetto latente diventerebbe un errore in faccia all'utente.
//
// La regola vive in una riga sola dentro la schermata; qui se ne prova la
// forma, che è ciò che conta ed è dove stava lo sbaglio.

/** La stessa espressione usata in CreateListingScreen per il prossimo posto. */
function prossimaPosizione(esistenti) {
  const max = (esistenti || []).reduce((m, p) => {
    const n = Number(p?.position);
    return Number.isFinite(n) && n > m ? n : m;
  }, -1);
  return max + 1;
}

describe("il posto della prossima foto", () => {
  it("il primo annuncio parte da zero", () => {
    expect(prossimaPosizione([])).toBe(0);
    expect(prossimaPosizione(null)).toBe(0);
  });

  it("con le foto in fila, va dopo l'ultima", () => {
    expect(prossimaPosizione([{ position: 0 }])).toBe(1);
    expect(prossimaPosizione([{ position: 0 }, { position: 1 }])).toBe(2);
  });

  it("dopo aver cancellato la prima, NON riusa un posto occupato", () => {
    // È il caso che rompeva: resta una sola foto, ma sta in posizione 1.
    // Il conteggio direbbe 1 — cioè proprio il posto già preso.
    expect(prossimaPosizione([{ position: 1 }])).toBe(2);
  });

  it("non si fa ingannare dall'ordine in cui arrivano", () => {
    expect(prossimaPosizione([{ position: 1 }, { position: 0 }])).toBe(2);
  });

  it("una posizione illeggibile viene scartata, non contata come zero", () => {
    // Number(null) fa 0: senza il controllo, una riga rotta si comporterebbe
    // come la prima foto e potrebbe far riusare un posto già occupato.
    expect(prossimaPosizione([{ position: null }, { position: 3 }])).toBe(4);
    expect(prossimaPosizione([{ position: "boh" }])).toBe(0);
    expect(prossimaPosizione([{}])).toBe(0);
  });
});
