// L'import di un biglietto non deve cancellare la descrizione scritta a mano.
//
// Il documento non contiene una descrizione — lo schema del parser non ha
// nemmeno quel campo, quindi `data.description` è sempre undefined. Il
// codice però faceva `description: data.description ?? ""`, che non
// "lasciava com'era": scriveva stringa vuota sopra il testo dell'utente e lo
// cancellava senza dire niente.
//
// Qui si prova il normalizzatore lato client, che è il punto in cui la
// risposta del server diventa i campi del modulo: se un giorno tornasse a
// produrre una `description` inventata, questi test lo segnalano.
jest.mock("../lib/backendApi", () => ({ fetchJson: jest.fn() }));

import { fetchJson } from "../lib/backendApi";
import { parseListingFromPdfAI, parseListingFromTextAI } from "../lib/descriptionParser";

const RISPOSTA_TRENO = {
  ok: true,
  data: {
    type: "train",
    title: "Vendo treno Roma-->Milano",
    origin: "Roma Termini",
    destination: "Milano Centrale",
    departAt: "2026-09-10 09:00",
    price: "89",
    provider: "Trenitalia",
    ticketClass: "Business",
    fareType: "Base",
    cercoVendo: "VENDO",
  },
};

describe("l'import non porta una descrizione", () => {
  beforeEach(() => fetchJson.mockReset());

  it("da PDF: nessuna descrizione nel risultato, nemmeno vuota", async () => {
    // Nemmeno "" : una stringa vuota, applicata al modulo, sovrascriverebbe
    // ciò che l'utente ha scritto. L'assenza della chiave è ciò che permette
    // alla schermata di lasciare il campo intatto.
    fetchJson.mockResolvedValueOnce(RISPOSTA_TRENO);
    const out = await parseListingFromPdfAI("base64finto");
    expect(out.description).toBeUndefined();
  });

  it("da testo: stesso normalizzatore, stessa garanzia", async () => {
    fetchJson.mockResolvedValueOnce(RISPOSTA_TRENO);
    const out = await parseListingFromTextAI("un testo qualsiasi");
    expect(out.description).toBeUndefined();
  });

  it("anche se il server ne mandasse una, non entra dal normalizzatore", async () => {
    // Difesa deliberata: la descrizione è l'unico pezzo scritto dal
    // venditore, ed è quello che il TrustScore analizza. Un testo generato
    // dal modello e pubblicato a nome dell'utente sarebbe l'AI che valuta la
    // propria scrittura. Se un giorno si decidesse di volerlo, va aggiunto
    // qui di proposito — e questo test va cambiato con cognizione, non
    // scoperto rotto.
    fetchJson.mockResolvedValueOnce({
      ok: true,
      data: { ...RISPOSTA_TRENO.data, description: "Descrizione scritta dal modello." },
    });
    const out = await parseListingFromPdfAI("x");
    expect(out.description).toBeUndefined();
  });

  it("i campi che il documento CONTIENE arrivano comunque", async () => {
    // Il contrappeso: "non tocchiamo la descrizione" non deve diventare
    // "l'import non riempie niente".
    fetchJson.mockResolvedValueOnce(RISPOSTA_TRENO);
    const out = await parseListingFromPdfAI("x");
    expect(out.ticketClass).toBe("Business");
    expect(out.fareType).toBe("Base");
    expect(out.provider).toBe("Trenitalia");
    expect(out.price).toBeTruthy();
  });
});
