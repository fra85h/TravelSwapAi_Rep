// Estrazione del motivo vero da un errore del backend.
//
// Nasce da un caso concreto: "Impossibile importare il PDF" era lo stesso
// messaggio per una chiave OpenAI scaduta, un timeout, un PDF illeggibile e
// un modello che non accetta allegati. Il server il motivo lo diceva —
// finiva in e.message via fetchJson — ma l'app lo scartava, e chi subiva il
// guasto non aveva modo di raccontarci cosa fosse successo.
import { describeBackendError } from "../lib/backendError";

describe("describeBackendError", () => {
  it("tira fuori il messaggio del server dal corpo JSON", () => {
    const err = new Error(
      'HTTP 502: Bad Gateway — {"ok":false,"error":"Il servizio AI ha risposto in un formato non valido."}',
    );
    expect(describeBackendError(err)).toBe("Il servizio AI ha risposto in un formato non valido.");
  });

  it("riconosce la chiave OpenAI mancante, che è un caso di configurazione", () => {
    const err = new Error(
      'HTTP 503: Service Unavailable — {"ok":false,"error":"Servizio AI non configurato sul server (OPENAI_API_KEY mancante)."}',
    );
    expect(describeBackendError(err)).toContain("OPENAI_API_KEY");
  });

  it("traduce il timeout in secondi, che è come lo si racconta", () => {
    expect(describeBackendError(new Error("Timeout dopo 90000ms: https://x/api"))).toBe(
      "nessuna risposta dopo 90s",
    );
  });

  it("se il corpo non è JSON mostra comunque l'inizio", () => {
    const err = new Error("HTTP 500: Internal Server Error — <html><body>Proxy error</body></html>");
    expect(describeBackendError(err)).toContain("Proxy error");
  });

  it("senza corpo resta almeno il codice HTTP", () => {
    expect(describeBackendError(new Error("HTTP 401: Unauthorized"))).toBe("HTTP 401");
  });

  it("non esplode e non inventa su input vuoti", () => {
    expect(describeBackendError(null)).toBeNull();
    expect(describeBackendError(undefined)).toBeNull();
    expect(describeBackendError(new Error(""))).toBeNull();
    expect(describeBackendError({})).toBeNull();
  });

  it("taglia i messaggi sconfinati: è una riga fra parentesi, non un log", () => {
    const err = new Error(`HTTP 500: x — {"error":"${"y".repeat(1000)}"}`);
    expect(describeBackendError(err).length).toBeLessThanOrEqual(200);
  });
});
