// Cosa si dice a chi sta scrivendo il prezzo.
//
// La regola che questi test difendono è una sola: si dicono solo fatti
// contati. Niente probabilità — quella la inventeremmo, perché non abbiamo
// ancora transazioni concluse da cui ricavarla, e chi legge abbasserebbe il
// prezzo per davvero sulla base di un numero uscito dal nulla.
import { marketContextItems, filtraComparabili, MERCATO, GIORNI_VICINI } from "../lib/marketContext.mjs";

const codici = (ctx) => marketContextItems(ctx).map((i) => i.code);
const voce = (ctx, code) => marketContextItems(ctx).find((i) => i.code === code);

describe("cosa c'è da dire", () => {
  it("senza niente da dire non si dice niente", () => {
    // Con la vetrina vuota — che oggi è il caso normale — la riga non deve
    // comparire affatto: "0 annunci simili, 0 in attesa" è peggio del
    // silenzio, perché è vero e deprimente insieme.
    expect(marketContextItems({})).toEqual([]);
    expect(marketContextItems({ comparabili: [], inAttesa: 0, prezzo: 50 })).toEqual([]);
  });

  it("conta gli annunci confrontabili", () => {
    const items = marketContextItems({ comparabili: [{ price: 30 }, { price: 40 }] });
    expect(codici({ comparabili: [{ price: 30 }, { price: 40 }] })).toEqual([MERCATO.SIMILI]);
    expect(items[0].params.n).toBe(2);
  });

  it("dice quanti costano meno del tuo, ma solo se ce ne sono", () => {
    const ctx = { comparabili: [{ price: 30 }, { price: 40 }, { price: 80 }], prezzo: 50 };
    expect(voce(ctx, MERCATO.PIU_ECONOMICI).params.n).toBe(2);

    // "0 costano meno" è rumore: chi sta scrivendo il prezzo più basso del
    // mercato non ha bisogno che glielo si dica in negativo.
    const piuBasso = { comparabili: [{ price: 80 }], prezzo: 50 };
    expect(codici(piuBasso)).toEqual([MERCATO.SIMILI]);
  });

  it("senza un prezzo scritto non si parla di prezzi", () => {
    const ctx = { comparabili: [{ price: 30 }] };
    expect(codici(ctx)).toEqual([MERCATO.SIMILI]);
    expect(codici({ ...ctx, prezzo: "" })).toEqual([MERCATO.SIMILI]);
    expect(codici({ ...ctx, prezzo: 0 })).toEqual([MERCATO.SIMILI]);
  });

  it("il prezzo scritto all'italiana viene capito", () => {
    // Arriva dal campo come stringa, e Number lo gestisce solo col punto.
    expect(voce({ comparabili: [{ price: 30 }], prezzo: "49.90" }, MERCATO.PIU_ECONOMICI).params.n).toBe(1);
  });

  it("chi segue la tratta si dice per ultimo", () => {
    // È la voce che dà speranza: chiudere con "però qualcuno lo aspetta" è
    // diverso dall'aprirci.
    const ctx = { comparabili: [{ price: 30 }], prezzo: 50, inAttesa: 2 };
    expect(codici(ctx)).toEqual([MERCATO.SIMILI, MERCATO.PIU_ECONOMICI, MERCATO.IN_ATTESA]);
  });

  it("qualcuno in attesa si dice anche se non c'è nessun altro annuncio", () => {
    // Anzi: è il caso in cui vale di più: nessuna concorrenza e una persona
    // che aspetta.
    expect(codici({ inAttesa: 1 })).toEqual([MERCATO.IN_ATTESA]);
  });

  it("\"non lo sappiamo\" non diventa \"nessuno\"", () => {
    // Number(null) fa 0. Se la lettura degli avvisi fallisce, il conteggio è
    // ignoto: dirlo come "0 persone" sarebbe un'informazione falsa su un
    // dato che pesa nella decisione di prezzo.
    expect(codici({ inAttesa: null })).toEqual([]);
    expect(codici({ inAttesa: undefined })).toEqual([]);
    expect(codici({ inAttesa: "boh" })).toEqual([]);
  });

  it("un prezzo illeggibile fra i confrontabili non conta come più economico", () => {
    const ctx = { comparabili: [{ price: null }, { price: "abc" }, { price: 10 }], prezzo: 50 };
    expect(voce(ctx, MERCATO.PIU_ECONOMICI).params.n).toBe(1);
  });
});

describe("quali annunci sono confrontabili", () => {
  const giorno = 24 * 60 * 60 * 1000;
  const base = new Date("2027-05-10T08:00:00Z");
  const fra = (giorni) => new Date(base.getTime() + giorni * giorno).toISOString();

  it("tiene solo le date vicine", () => {
    const righe = [
      { id: "a", type: "train", depart_at: fra(0) },
      { id: "b", type: "train", depart_at: fra(GIORNI_VICINI) },
      { id: "c", type: "train", depart_at: fra(GIORNI_VICINI + 1) },
      { id: "d", type: "train", depart_at: fra(-GIORNI_VICINI) },
    ];
    const ok = filtraComparabili(righe, { tipo: "train", dataEvento: base.toISOString() });
    expect(ok.map((r) => r.id)).toEqual(["a", "b", "d"]);
  });

  it("esclude l'annuncio che si sta modificando", () => {
    // Senza, in modifica un annuncio conterebbe se stesso fra i concorrenti.
    const righe = [{ id: "io", type: "train", depart_at: fra(0) }, { id: "altro", type: "train", depart_at: fra(0) }];
    const ok = filtraComparabili(righe, { tipo: "train", dataEvento: base.toISOString(), escludiId: "io" });
    expect(ok.map((r) => r.id)).toEqual(["altro"]);
  });

  it("un hotel non è confrontabile con un treno", () => {
    const righe = [{ id: "h", type: "hotel", check_in: fra(0) }, { id: "t", type: "train", depart_at: fra(0) }];
    expect(filtraComparabili(righe, { tipo: "train", dataEvento: base.toISOString() }).map((r) => r.id)).toEqual(["t"]);
    expect(filtraComparabili(righe, { tipo: "hotel", dataEvento: base.toISOString() }).map((r) => r.id)).toEqual(["h"]);
  });

  it("senza una data nostra non si filtra sulle date", () => {
    // Sta ancora compilando: meglio un conteggio largo che nessun conteggio.
    const righe = [{ id: "a", type: "train", depart_at: fra(30) }];
    expect(filtraComparabili(righe, { tipo: "train", dataEvento: null })).toHaveLength(1);
  });

  it("un annuncio senza data non entra in un confronto per date", () => {
    const righe = [{ id: "a", type: "train", depart_at: null }];
    expect(filtraComparabili(righe, { tipo: "train", dataEvento: base.toISOString() })).toHaveLength(0);
  });

  it("niente in ingresso, niente in uscita", () => {
    expect(filtraComparabili(null, { tipo: "train" })).toEqual([]);
    expect(filtraComparabili([null, undefined], { tipo: "train" })).toEqual([]);
  });
});
