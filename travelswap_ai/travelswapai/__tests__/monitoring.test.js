// Il tracciamento errori lato client.
//
// Due proprietà da difendere, e nessuna delle due è "funziona":
//
// 1. NON deve mai far fallire ciò che stava tracciando. Viene chiamato
//    dall'ErrorBoundary, cioè quando l'app si è già rotta una volta: un
//    secondo errore lì dentro sostituirebbe la schermata "Qualcosa è
//    andato storto" con una pagina bianca — il problema esatto da cui
//    l'ErrorBoundary era nato.
// 2. NON deve far uscire segreti. L'indirizzo della pagina può contenere
//    il token di recupero password nel frammento: con quello si è
//    quell'utente.
//
// Il modulo legge l'indirizzo del server una volta sola, quando viene
// importato: da qui `jest.isolateModules`, che permette di ricaricarlo con
// un ambiente diverso invece di dipendere da come è stato lanciato jest.
const loadWith = (apiBase) => {
  const prev = process.env.EXPO_PUBLIC_API_BASE;
  process.env.EXPO_PUBLIC_API_BASE = apiBase;
  let mod;
  jest.isolateModules(() => {
    mod = require("../lib/monitoring");
  });
  process.env.EXPO_PUBLIC_API_BASE = prev;
  return mod;
};

describe("monitoring — sicurezza", () => {
  it("captureError non lancia mai, con qualunque argomento", () => {
    const { captureError } = loadWith("https://api.test");
    expect(() => captureError(new Error("boom"))).not.toThrow();
    expect(() => captureError(null)).not.toThrow();
    expect(() => captureError(undefined, { componentStack: "x" })).not.toThrow();
    expect(() => captureError("non è un errore")).not.toThrow();
    expect(() => captureError({ senza: "message" })).not.toThrow();
  });

  it("non lancia nemmeno se la rete fallisce di brutto", () => {
    const { captureError } = loadWith("https://api.test");
    global.fetch = jest.fn(() => {
      throw new Error("rete assente");
    });
    expect(() => captureError(new Error("boom"))).not.toThrow();
  });

  it("senza indirizzo del server non contatta nessuno", () => {
    const { captureError } = loadWith("");
    global.fetch = jest.fn();
    captureError(new Error("boom"));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("monitoring — cosa viene spedito", () => {
  let mod;
  let fetchMock;

  beforeEach(() => {
    mod = loadWith("https://api.test");
    fetchMock = jest.fn(() => Promise.resolve({ ok: true }));
    global.fetch = fetchMock;
  });

  const bodyOf = (call) => JSON.parse(call[1].body);

  it("manda messaggio e stack al nostro endpoint", () => {
    const err = new Error("Cannot read properties of undefined");
    mod.captureError(err, { componentStack: "in ListingCard" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/api/client-errors");
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.message).toBe("Cannot read properties of undefined");
    expect(typeof body.stack).toBe("string");
    expect(body.context.componentStack).toBe("in ListingCard");
  });

  it("il token di recupero password nel frammento NON esce", () => {
    // Il caso concreto: l'utente apre il link di reset, l'app va in crash
    // mentre l'indirizzo contiene ancora il token.
    global.window = {
      location: {
        href: "https://travelswap.app/auth/reset#access_token=SEGRETO&refresh_token=ANCHE",
      },
    };
    mod.captureError(new Error("boom"));
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.url).toBe("https://travelswap.app/auth/reset");
    expect(JSON.stringify(body)).not.toContain("SEGRETO");
    expect(JSON.stringify(body)).not.toContain("ANCHE");
    delete global.window;
  });

  it("anche il codice OAuth nella query NON esce", () => {
    global.window = { location: { href: "https://travelswap.app/auth/callback?code=SEGRETO" } };
    mod.captureError(new Error("boom"));
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.url).toBe("https://travelswap.app/auth/callback");
    expect(JSON.stringify(body)).not.toContain("SEGRETO");
    delete global.window;
  });

  it("messaggi e stack sconfinati vengono tagliati", () => {
    const err = new Error("x".repeat(50000));
    err.stack = "y".repeat(50000);
    mod.captureError(err);
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.message.length).toBeLessThanOrEqual(500);
    expect(body.stack.length).toBeLessThanOrEqual(4000);
  });

  it("si ferma dopo 10 segnalazioni: un'app rotta in ciclo non tempesta il server", () => {
    for (let i = 0; i < 50; i++) mod.captureError(new Error(`errore ${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});

describe("monitoring — avvio", () => {
  it("fuori dal web non aggancia niente", () => {
    // L'ambiente di jest è quello nativo: gli eventi globali del browser
    // non esistono, e initMonitoring deve accorgersene invece di esplodere.
    const { initMonitoring, monitoringEnabled } = loadWith("https://api.test");
    expect(initMonitoring()).toBe(false);
    expect(monitoringEnabled()).toBe(false);
  });
});
