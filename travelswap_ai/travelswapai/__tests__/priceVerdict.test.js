import { priceVerdict, percentAbove, PRICE_VERDICT, HIGH_THRESHOLD } from "../lib/priceVerdict";

describe("priceVerdict", () => {
  it("avvisa quando il prezzo supera la stima oltre la soglia", () => {
    expect(priceVerdict(140, 100)).toBe(PRICE_VERDICT.HIGH);
    expect(priceVerdict(200, 50)).toBe(PRICE_VERDICT.HIGH);
  });

  it("tace dentro la soglia: le stime dell'AI sono rumorose", () => {
    // Un avviso che compare sempre smette di essere letto. Sotto il 25% la
    // differenza non significa niente.
    expect(priceVerdict(100, 100)).toBe(PRICE_VERDICT.OK);
    expect(priceVerdict(120, 100)).toBe(PRICE_VERDICT.OK);
    expect(priceVerdict(125, 100)).toBe(PRICE_VERDICT.OK); // esattamente sulla soglia
  });

  it("non dice niente su un prezzo SOTTO mercato, ed è voluto", () => {
    // Segnalarlo spingerebbe i prezzi verso l'alto su un marketplace che ha
    // come principio il tetto del prezzo pagato.
    expect(priceVerdict(40, 100)).toBe(PRICE_VERDICT.OK);
    expect(priceVerdict(1, 100)).toBe(PRICE_VERDICT.OK);
  });

  it("senza una stima valida non giudica", () => {
    for (const s of [null, undefined, 0, -10, "", "abc", NaN]) {
      expect(priceVerdict(100, s)).toBe(PRICE_VERDICT.UNKNOWN);
    }
  });

  it("senza un prezzo valido non giudica", () => {
    for (const p of [null, undefined, 0, -5, "", "abc"]) {
      expect(priceVerdict(p, 100)).toBe(PRICE_VERDICT.UNKNOWN);
    }
  });

  it("accetta i numeri anche come stringhe, com'è il campo del form", () => {
    expect(priceVerdict("140", "100")).toBe(PRICE_VERDICT.HIGH);
    expect(priceVerdict("110", "100")).toBe(PRICE_VERDICT.OK);
  });

  it("la soglia è quella dichiarata, non un numero sparso nel codice", () => {
    expect(HIGH_THRESHOLD).toBe(1.25);
    expect(priceVerdict(100 * HIGH_THRESHOLD + 0.01, 100)).toBe(PRICE_VERDICT.HIGH);
  });
});

describe("percentAbove", () => {
  it("dice di quanto si è sopra, arrotondato", () => {
    expect(percentAbove(140, 100)).toBe(40);
    expect(percentAbove(133, 100)).toBe(33);
  });

  it("sotto o pari alla stima non restituisce niente da mostrare", () => {
    expect(percentAbove(100, 100)).toBeNull();
    expect(percentAbove(60, 100)).toBeNull();
  });

  it("non esplode su input non validi", () => {
    expect(percentAbove(null, 100)).toBeNull();
    expect(percentAbove(100, 0)).toBeNull();
    expect(percentAbove("x", "y")).toBeNull();
  });
});
