// Il corridoio: da dove vieni, dove studi.
//
// La regola che questi test difendono più di ogni altra: le due città si
// salvano SEPARATE, mai unite in "Milano → Napoli". HomeScreen confronta le
// località preferite con location/route_from/route_to per contenimento di
// stringa — "milano" è contenuto in "roma → milano", "milano napoli" non è
// contenuto in niente. Salvarle unite sarebbe il modo silenzioso di non far
// funzionare niente, e nessuno se ne accorgerebbe guardando la schermata:
// i campi sarebbero pieni, la vetrina ordinata a caso.
import { cittaDaPrefs, prefsConCorridoio, corridoio } from "../lib/corridoio.mjs";

describe("cosa si salva", () => {
  it("le due città restano separate", () => {
    const p = prefsConCorridoio({ types: ["train"] }, { casa: "Napoli", studio: "Milano" });
    expect(p.locations).toEqual(["Napoli", "Milano"]);
    expect(p.homeCity).toBe("Napoli");
    expect(p.studyCity).toBe("Milano");
  });

  it("il vecchio campo singolo continua a essere scritto", () => {
    // Non si sa chi altro lo legge: aggiungere un campo non deve rompere
    // chi leggeva quelli di prima.
    const p = prefsConCorridoio({}, { casa: "Napoli", studio: "Milano" });
    expect(p.location).toBe("Napoli");
  });

  it("non tocca il resto delle preferenze", () => {
    const p = prefsConCorridoio({ types: ["train", "hotel"], maxPrice: 80 }, { casa: "Roma", studio: "Torino" });
    expect(p.types).toEqual(["train", "hotel"]);
    expect(p.maxPrice).toBe(80);
  });

  it("la stessa città due volte non è un corridoio", () => {
    // Peserebbe il doppio nell'ordinamento della vetrina, per niente.
    const p = prefsConCorridoio({}, { casa: "Milano", studio: "milano" });
    expect(p.locations).toEqual(["Milano"]);
  });

  it("una città sola si salva lo stesso", () => {
    // Chi non è fuorisede ha una città e basta: va bene, e la vetrina la usa.
    expect(prefsConCorridoio({}, { casa: "Bologna", studio: "" }).locations).toEqual(["Bologna"]);
    expect(prefsConCorridoio({}, { casa: "", studio: "Bologna" }).locations).toEqual(["Bologna"]);
  });

  it("senza niente non inventa niente", () => {
    const p = prefsConCorridoio({ types: [] }, { casa: "  ", studio: "" });
    expect(p.locations).toBeUndefined();
    expect(p.location).toBeUndefined();
  });

  it("gli spazi di troppo si perdono per strada", () => {
    const p = prefsConCorridoio({}, { casa: "  Reggio   Emilia ", studio: "Milano" });
    expect(p.locations).toEqual(["Reggio Emilia", "Milano"]);
  });
});

describe("cosa si rilegge", () => {
  it("rilegge quello che ha scritto", () => {
    const p = prefsConCorridoio({}, { casa: "Napoli", studio: "Milano" });
    expect(cittaDaPrefs(p)).toEqual({ casa: "Napoli", studio: "Milano" });
  });

  it("recupera chi aveva scritto la tratta nel vecchio campo libero", () => {
    // Il campo di prima diceva "Es. Milano → Roma": chi l'ha compilato così
    // non deve ritrovarsi la schermata vuota e ricominciare da capo.
    for (const vecchio of ["Milano → Roma", "Milano-->Roma", "Milano, Roma"]) {
      expect(cittaDaPrefs({ location: vecchio })).toEqual({ casa: "Milano", studio: "Roma" });
    }
  });

  it("recupera anche dall'array di più località", () => {
    expect(cittaDaPrefs({ locations: ["Milano", "Roma"] })).toEqual({ casa: "Milano", studio: "Roma" });
  });

  it("una città sola resta una città sola", () => {
    expect(cittaDaPrefs({ location: "Bologna" })).toEqual({ casa: "Bologna", studio: "" });
  });

  it("senza preferenze non si inventa un corridoio", () => {
    for (const p of [null, undefined, {}, { locations: [] }, { location: "" }]) {
      expect(cittaDaPrefs(p)).toEqual({ casa: "", studio: "" });
    }
  });
});

describe("il corridoio da nominare nei testi", () => {
  it("con due città si può scrivere", () => {
    expect(corridoio({ homeCity: "Napoli", studyCity: "Milano" }).etichetta).toBe("Napoli ↔ Milano");
  });

  it("con una sola non si nomina niente", () => {
    // Meglio il testo generico che "Napoli ↔ ": una frase monca è peggio di
    // una frase generica.
    expect(corridoio({ homeCity: "Napoli" })).toBe(null);
    expect(corridoio({})).toBe(null);
    expect(corridoio(null)).toBe(null);
  });
});
