// "Sei offline?" — un solo posto che lo sa.
//
// Prima non lo sapeva nessuno, e ogni elenco vuoto raccontava la stessa
// bugia: "Nessun annuncio salvato" a chi era in galleria. Il rilevamento non
// usa librerie native (costringerebbero a una build EAS): deduce lo stato
// dagli errori delle richieste che l'app fa già.
//
// Il rischio da difendere è la falsa segnalazione: dire "sei offline" a chi
// non lo è fa più danno che tacere, perché contraddice ciò che l'utente vede
// funzionare.
import {
  isOffline,
  subscribeConnectivity,
  reportNetworkFailure,
  reportNetworkSuccess,
  isNetworkError,
} from "../lib/connectivity";

describe("riconoscere un errore di rete", () => {
  it("riconosce i messaggi dei motori JS diversi", () => {
    // Non esiste un codice: ogni motore ha il suo messaggio, e sono questi.
    expect(isNetworkError(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("Load failed"))).toBe(true);
  });

  it("un timeout NON è assenza di rete", () => {
    // La rete c'era: era il server a essere lento. Confonderli manderebbe
    // l'utente a controllare il wi-fi per un problema che non è suo.
    const err = new Error("Timeout dopo 20000ms: /api/listings");
    err.name = "AbortError";
    expect(isNetworkError(err)).toBe(false);
  });

  it("un errore applicativo non è assenza di rete", () => {
    // Una risposta, anche brutta, dimostra che la rete funziona.
    expect(isNetworkError(new Error("HTTP 500: Internal Server Error"))).toBe(false);
    expect(isNetworkError(new Error("Hai già un annuncio identico"))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe("lo stato e chi lo ascolta", () => {
  afterEach(() => reportNetworkSuccess());

  it("un fallimento di rete mette offline, una risposta rimette online", () => {
    reportNetworkFailure();
    expect(isOffline()).toBe(true);
    reportNetworkSuccess();
    expect(isOffline()).toBe(false);
  });

  it("avvisa chi si è iscritto, e solo quando lo stato CAMBIA", () => {
    // Senza questo controllo ogni richiesta fallita in una raffica
    // ridisegnerebbe mezza app per dire una cosa che era già vera.
    const visti = [];
    const stop = subscribeConnectivity((off) => visti.push(off));

    reportNetworkFailure();
    reportNetworkFailure();
    reportNetworkFailure();
    reportNetworkSuccess();

    expect(visti).toEqual([true, false]);
    stop();
  });

  it("disiscriversi funziona davvero", () => {
    // Una schermata smontata che continua a ricevere aggiornamenti è un
    // avviso di React e una perdita di memoria.
    const visti = [];
    const stop = subscribeConnectivity((off) => visti.push(off));
    stop();
    reportNetworkFailure();
    expect(visti).toEqual([]);
  });

  it("un ascoltatore che esplode non zittisce gli altri", () => {
    const visti = [];
    const stop1 = subscribeConnectivity(() => { throw new Error("rotto"); });
    const stop2 = subscribeConnectivity((off) => visti.push(off));
    reportNetworkFailure();
    expect(visti).toEqual([true]);
    stop1(); stop2();
  });

  it("subscribe con un argomento non valido non rompe niente", () => {
    expect(() => subscribeConnectivity(null)()).not.toThrow();
  });
});
