// I campi estratti dal documento devono ARRIVARE al modulo.
//
// Caso reale: importando un biglietto, classe e tariffa restavano vuote pur
// essendo state estratte correttamente dal server. Il motivo è che il
// client ricostruisce la risposta da un ELENCO ESPLICITO di campi
// (normalizeParsedPayload in lib/descriptionParser.js): tutto ciò che non è
// nominato lì viene buttato via in silenzio, senza un errore, senza un log.
//
// È un modo di rompersi particolarmente sgradevole, perché il campo nuovo
// funziona su tutta la catena — prompt, schema, database, interfaccia — e
// fallisce nell'unico punto che nessuno guarda. Questo test è la rete: se
// domani si aggiunge un campo e ci si dimentica del normalizzatore, qui si
// vede subito.
jest.mock("../lib/backendApi", () => ({ fetchJson: jest.fn() }));

import { fetchJson } from "../lib/backendApi";
import { parseListingFromPdfAI, parseListingFromTextAI } from "../lib/descriptionParser";

const RISPOSTA_SERVER = {
  ok: true,
  data: {
    type: "train",
    title: "Vendo treno Roma-->Milano solo andata",
    origin: "Roma Termini",
    destination: "Milano Centrale",
    departAt: "2026-09-10 09:00",
    arriveAt: "2026-09-10 12:30",
    price: "89",
    provider: "Trenitalia",
    ticketClass: "Business",
    fareType: "Super Economy",
    isNamedTicket: true,
    gender: "M",
    pnr: "ABC123",
    cercoVendo: "VENDO",
  },
};

describe("i campi del documento sopravvivono alla normalizzazione", () => {
  beforeEach(() => fetchJson.mockReset());

  it("import da PDF: classe, tariffa e operatore arrivano al modulo", () => {
    fetchJson.mockResolvedValueOnce(RISPOSTA_SERVER);
    return parseListingFromPdfAI("base64finto").then((out) => {
      expect(out.ticketClass).toBe("Business");
      expect(out.fareType).toBe("Super Economy");
      expect(out.provider).toBe("Trenitalia");
    });
  });

  it("import da testo: stessa cosa, è lo stesso normalizzatore", () => {
    fetchJson.mockResolvedValueOnce(RISPOSTA_SERVER);
    return parseListingFromTextAI("un testo qualsiasi").then((out) => {
      expect(out.ticketClass).toBe("Business");
      expect(out.fareType).toBe("Super Economy");
    });
  });

  it("classe e tariffa restano DISTINTE, non si contaminano", () => {
    // Un biglietto può essere Business (classe) con tariffa Economy:
    // scambiarle o dedurre l'una dall'altra darebbe un avviso di
    // reintestabilità sbagliato.
    fetchJson.mockResolvedValueOnce(RISPOSTA_SERVER);
    return parseListingFromPdfAI("x").then((out) => {
      expect(out.ticketClass).not.toBe(out.fareType);
    });
  });

  it("se il server non le manda restano null, non undefined", () => {
    // null è "non c'era sul documento"; undefined farebbe sparire la chiave
    // e il modulo non saprebbe distinguere i due casi.
    fetchJson.mockResolvedValueOnce({ ok: true, data: { type: "train", title: "x" } });
    return parseListingFromPdfAI("x").then((out) => {
      expect(out.ticketClass).toBeNull();
      expect(out.fareType).toBeNull();
    });
  });

  it("accetta anche le grafie snake_case, se il server cambiasse convenzione", () => {
    fetchJson.mockResolvedValueOnce({
      ok: true,
      data: { type: "train", title: "x", ticket_class: "Prima", fare_type: "Base" },
    });
    return parseListingFromPdfAI("x").then((out) => {
      expect(out.ticketClass).toBe("Prima");
      expect(out.fareType).toBe("Base");
    });
  });
});
