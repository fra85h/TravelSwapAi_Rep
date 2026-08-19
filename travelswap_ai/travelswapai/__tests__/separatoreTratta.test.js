// Una tratta si mostra in un modo solo.
//
// Nel trasporto dei dati convivono due separatori, ed è voluto: il prompt del
// server impone l'ASCII "-->" perché il modello lo riproduce senza sbavature,
// mentre una freccia Unicode gli esce ora in un modo ora in un altro. Il
// difetto era che quel formato arrivava intatto fino allo schermo: un
// annuncio importato dalla descrizione compariva in vetrina come
// "Vendo treno Roma-->Milano solo andata" accanto a quelli scritti a mano,
// che dicono "Roma → Milano". Stesso viaggio, due grafie, stessa schermata.
import { normalizzaSeparatoreTratta, SEPARATORE_TRATTA } from "../lib/listingTitle";

// Gli stessi lettori di tratte che esistono nell'app: se dopo la conversione
// smettessero di ritrovare le due città, avremmo sistemato l'aspetto e rotto
// la sostanza.
const splitRoute = (loc) => String(loc || "").split(/-->|→/).map((s) => s.trim()).filter(Boolean);

describe("come si mostra una tratta", () => {
  it("converte il separatore di trasporto in quello che si legge", () => {
    expect(normalizzaSeparatoreTratta("Roma-->Milano")).toBe("Roma → Milano");
    expect(normalizzaSeparatoreTratta("Vendo treno Roma-->Milano solo andata"))
      .toBe("Vendo treno Roma → Milano solo andata");
  });

  it("sistema anche la spaziatura, qualunque fosse", () => {
    // Il modello a volte mette spazi attorno ai trattini nonostante il prompt.
    for (const grezzo of ["Roma --> Milano", "Roma-->  Milano", "Roma  -->Milano"]) {
      expect(normalizzaSeparatoreTratta(grezzo)).toBe("Roma → Milano");
    }
  });

  it("non tocca ciò che è già a posto", () => {
    expect(normalizzaSeparatoreTratta("Roma → Milano")).toBe("Roma → Milano");
    expect(normalizzaSeparatoreTratta("Roma")).toBe("Roma");
  });

  it("niente in ingresso, niente in uscita", () => {
    expect(normalizzaSeparatoreTratta("")).toBe("");
    expect(normalizzaSeparatoreTratta(null)).toBe(null);
    expect(normalizzaSeparatoreTratta(undefined)).toBe(undefined);
  });

  it("il separatore esposto è quello usato davvero", () => {
    // Se qualcuno cambiasse la costante senza cambiare la funzione, o
    // viceversa, le tratte tornerebbero a mostrarsi in due modi.
    expect(normalizzaSeparatoreTratta("A-->B")).toBe(`A${SEPARATORE_TRATTA}B`);
  });
});

describe("la tratta resta leggibile dal codice", () => {
  it("dopo la conversione le due città si ritrovano ancora", () => {
    expect(splitRoute(normalizzaSeparatoreTratta("Roma-->Milano"))).toEqual(["Roma", "Milano"]);
  });

  it("e le righe già salvate col vecchio separatore continuano a funzionare", () => {
    // È il motivo per cui questa conversione non ha bisogno di toccare i
    // dati per forza: tutti i lettori accettano da sempre entrambe le grafie.
    expect(splitRoute("Roma-->Milano")).toEqual(["Roma", "Milano"]);
    expect(splitRoute("Roma → Milano")).toEqual(["Roma", "Milano"]);
  });
});
