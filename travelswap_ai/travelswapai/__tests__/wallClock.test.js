// Le date dell'annuncio si leggono "da parete".
//
// La regola che questi test difendono: il giorno e l'ora mostrati sono
// quelli che ha scritto chi pubblica, identici per chiunque guardi da
// qualunque fuso. Il valore in banca dati è naive (salvato come UTC), quindi
// va riletto in UTC: applicare il fuso di chi legge sposta l'orario e, per i
// viaggi serali, il giorno.
//
// I test girano con TZ=Europe/Rome (impostato qui sotto) perché è il fuso in
// cui il difetto si vedeva: con TZ=UTC passerebbero anche con la vecchia
// implementazione, senza accorgersi di niente.
process.env.TZ = "Europe/Rome";

import { formatWallClock, formatWallShortDate } from "../lib/wallClock.mjs";

describe("orario da parete, esteso", () => {
  it("mostra l'ora scritta, non quella del telefono", () => {
    // 07:31 alla stazione deve restare 07:31 anche a un lettore italiano,
    // che con toLocale* avrebbe letto 09:31.
    expect(formatWallClock("2026-07-18T07:31:00+00:00", "it")).toBe("sab 18 lug 2026 · 07:31");
  });

  it("non fa scivolare il giorno per i treni della sera", () => {
    // È il caso che rompeva gli elenchi: un treno delle 23:30 del 18 luglio
    // in Italia (UTC+2) diventava l'01:30 del 19.
    expect(formatWallClock("2026-07-18T23:30:00+00:00", "it")).toBe("sab 18 lug 2026 · 23:30");
    expect(formatWallShortDate("2026-07-18T23:30:00+00:00", "it")).toBe("18 lug");
  });

  it("vale anche in inverno, quando l'offset è di un'ora sola", () => {
    expect(formatWallClock("2026-01-18T23:30:00+00:00", "it")).toBe("dom 18 gen 2026 · 23:30");
  });

  it("senza orario mostra solo il giorno", () => {
    expect(formatWallClock("2026-07-18T07:31:00+00:00", "it", false)).toBe("sab 18 lug 2026");
  });

  it("una data secca resta il giorno che c'è scritto", () => {
    // check_in/check_out sono colonne `date`: "2026-07-18" è mezzanotte UTC,
    // e in un fuso a ovest di Greenwich diventerebbe il 17.
    expect(formatWallClock("2026-07-18", "it", false)).toBe("sab 18 lug 2026");
    expect(formatWallShortDate("2026-07-18", "it")).toBe("18 lug");
  });

  it("parla le tre lingue dell'app", () => {
    expect(formatWallClock("2026-07-18T07:31:00+00:00", "en", false)).toBe("Sat 18 Jul 2026");
    expect(formatWallClock("2026-07-18T07:31:00+00:00", "es", false)).toBe("sáb 18 jul 2026");
    // Lingua sconosciuta: italiano, non un crash.
    expect(formatWallClock("2026-07-18T07:31:00+00:00", "de", false)).toBe("sab 18 lug 2026");
  });
});

describe("orario da parete, corto", () => {
  it("tiene il giorno a due cifre come faceva toLocaleDateString", () => {
    // Nell'elenco le date stanno incolonnate: "05 lug" e "18 lug" hanno la
    // stessa larghezza, "5 lug" no.
    expect(formatWallShortDate("2026-07-05T10:00:00+00:00", "it")).toBe("05 lug");
  });

  it("non inventa niente su un valore mancante o illeggibile", () => {
    // In un elenco fitto una data rotta è rumore: meglio niente che
    // "Invalid Date". Era già il comportamento dei formattatori sostituiti.
    for (const v of [null, undefined, "", "domani", {}]) {
      expect(formatWallShortDate(v, "it")).toBe("");
    }
  });
});

describe("il valore mancante nella scheda annuncio", () => {
  it("resta un trattino, non una data finta", () => {
    expect(formatWallClock(null, "it")).toBe("—");
    expect(formatWallClock("", "it")).toBe("—");
  });

  it("un input illeggibile si mostra com'è", () => {
    // Qui c'è spazio per una riga intera: far vedere il valore grezzo aiuta
    // chi ce lo segnala più di un trattino che nasconde il problema.
    expect(formatWallClock("boh", "it")).toBe("boh");
  });
});
