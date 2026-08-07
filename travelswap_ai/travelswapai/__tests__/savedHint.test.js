// Il suggerimento "dove è finito quello che hai salvato".
//
// Si dice una volta sola, la prima. È la regola che rende utile il
// messaggio: un "salvato!" a ogni stellina insegna soltanto a ignorarlo, e
// poi a ignorare anche quello che conta. Questi test difendono proprio
// quella "una volta sola".
import {
  hintKey, primoSalvataggio, segnaHintMostrato,
  mostraHintPreferiti, subscribeSavedHint,
} from "../lib/savedHint.mjs";

function memoria(iniziale = {}) {
  const dati = { ...iniziale };
  return {
    dati,
    getItem: async (k) => (k in dati ? dati[k] : null),
    setItem: async (k, v) => { dati[k] = v; },
  };
}

const ANNA = "11111111-1111-1111-1111-111111111111";
const BRUNO = "22222222-2222-2222-2222-222222222222";

describe("una volta sola, la prima", () => {
  it("la prima volta sì, la seconda no", async () => {
    const s = memoria();
    expect(await primoSalvataggio(s, ANNA)).toBe(true);
    await segnaHintMostrato(s, ANNA);
    expect(await primoSalvataggio(s, ANNA)).toBe(false);
  });

  it("vale per ogni persona: il flag è intestato all'utente", async () => {
    // Su un dispositivo condiviso il suggerimento serve a ognuno la sua
    // prima volta — stessa ragione della bozza di "Crea annuncio".
    const s = memoria();
    await segnaHintMostrato(s, ANNA);
    expect(await primoSalvataggio(s, ANNA)).toBe(false);
    expect(await primoSalvataggio(s, BRUNO)).toBe(true);
  });

  it("senza utente non si promette niente", async () => {
    const s = memoria();
    expect(await primoSalvataggio(s, null)).toBe(false);
    expect(hintKey(null)).toBeNull();
    expect(hintKey("  ")).toBeNull();
  });

  it("se lo storage non si legge, si tace", async () => {
    // Meglio non mostrarlo mai che mostrarlo a ogni salvataggio: il caso
    // rumoroso è quello che fa disattivare gli avvisi.
    const rotto = { getItem: async () => { throw new Error("no"); }, setItem: async () => { throw new Error("no"); } };
    expect(await primoSalvataggio(rotto, ANNA)).toBe(false);
    await expect(segnaHintMostrato(rotto, ANNA)).resolves.toBeUndefined();
  });
});

describe("dalla stellina alla striscia", () => {
  it("chi si è iscritto viene avvisato", () => {
    const visti = [];
    const stop = subscribeSavedHint(() => visti.push(1));
    mostraHintPreferiti();
    expect(visti).toHaveLength(1);
    stop();
  });

  it("disiscriversi funziona davvero", () => {
    // Una schermata smontata che continua a ricevere aggiornamenti è un
    // avviso di React e una perdita di memoria.
    const visti = [];
    const stop = subscribeSavedHint(() => visti.push(1));
    stop();
    mostraHintPreferiti();
    expect(visti).toHaveLength(0);
  });

  it("un ascoltatore che esplode non zittisce gli altri", () => {
    const visti = [];
    const s1 = subscribeSavedHint(() => { throw new Error("rotto"); });
    const s2 = subscribeSavedHint(() => visti.push(1));
    mostraHintPreferiti();
    expect(visti).toHaveLength(1);
    s1(); s2();
  });

  it("subscribe con un argomento non valido non rompe niente", () => {
    expect(() => subscribeSavedHint(null)()).not.toThrow();
  });
});
