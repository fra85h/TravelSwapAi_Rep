// Dalla tariffa alla trasferibilità del nominativo.
//
// La proprietà che conta più di tutte è l'ULTIMA di questo file: davanti a
// una tariffa che non riconosciamo la risposta deve essere "non lo so", mai
// un valore inventato. Da questo dato dipende se chi compra si ritroverà un
// biglietto utilizzabile: un "sì" sbagliato è peggio di un silenzio.
import { nameChangeFromFare, resolveNameChange, NAME_CHANGE } from "../lib/fareRules";

describe("nameChangeFromFare", () => {
  it("riconosce le tariffe più restrittive di Trenitalia", () => {
    expect(nameChangeFromFare("Super Economy", "Trenitalia")).toBe(NAME_CHANGE.NOT_ALLOWED);
    expect(nameChangeFromFare("Economy", "Trenitalia")).toBe(NAME_CHANGE.NOT_ALLOWED);
  });

  it("riconosce le tariffe flessibili", () => {
    expect(nameChangeFromFare("Base", "Trenitalia")).toBe(NAME_CHANGE.ALLOWED);
    expect(nameChangeFromFare("Flex", "Italo")).toBe(NAME_CHANGE.ALLOWED);
  });

  it("«super economy» non viene catturata dalla regola di «economy»", () => {
    // L'ordine delle regole è la cosa che rende corretto questo caso: la
    // tariffa più specifica va valutata per prima. Invertendole, entrambe
    // finirebbero nella stessa risposta e la distinzione sparirebbe.
    expect(nameChangeFromFare("SuperEconomy", "Trenitalia")).toBe(NAME_CHANGE.NOT_ALLOWED);
    expect(nameChangeFromFare("Super-Economy", "Trenitalia")).toBe(NAME_CHANGE.NOT_ALLOWED);
  });

  it("tollera maiuscole, spazi e trattini come li scrive un biglietto vero", () => {
    expect(nameChangeFromFare("  SUPER ECONOMY  ", "trenitalia")).toBe(NAME_CHANGE.NOT_ALLOWED);
    expect(nameChangeFromFare("low cost", "Italo")).toBe(NAME_CHANGE.NOT_ALLOWED);
    expect(nameChangeFromFare("LOW-COST", "NTV Italo")).toBe(NAME_CHANGE.NOT_ALLOWED);
  });

  it("senza operatore riconosciuto usa comunque il nome della tariffa", () => {
    expect(nameChangeFromFare("Super Economy", null)).toBe(NAME_CHANGE.NOT_ALLOWED);
    expect(nameChangeFromFare("Super Economy", "Operatore Sconosciuto")).toBe(NAME_CHANGE.NOT_ALLOWED);
  });

  it("davanti a ciò che non conosce risponde «non lo so», non indovina", () => {
    for (const fare of [null, undefined, "", "   ", "Tariffa Speciale Estate", "XYZ", "Standard"]) {
      expect(nameChangeFromFare(fare, "Trenitalia")).toBe(NAME_CHANGE.UNKNOWN);
    }
  });
});

describe("resolveNameChange", () => {
  it("la dichiarazione del venditore vince sulla deduzione", () => {
    // Il venditore il biglietto ce l'ha davanti, noi no.
    expect(resolveNameChange({ declared: true, fareType: "Super Economy", operator: "Trenitalia" }))
      .toEqual({ allowed: true, source: "declared" });
    expect(resolveNameChange({ declared: false, fareType: "Base", operator: "Trenitalia" }))
      .toEqual({ allowed: false, source: "declared" });
  });

  it("senza dichiarazione usa la tariffa, marcandone l'origine", () => {
    expect(resolveNameChange({ declared: null, fareType: "Base", operator: "Trenitalia" }))
      .toEqual({ allowed: true, source: "fare" });
    expect(resolveNameChange({ declared: undefined, fareType: "Economy", operator: "Trenitalia" }))
      .toEqual({ allowed: false, source: "fare" });
  });

  it("senza dichiarazione né tariffa riconosciuta resta tutto vuoto", () => {
    // NULL su entrambi i campi è ciò che il vincolo a DB si aspetta:
    // un valore senza origine (o viceversa) descriverebbe uno stato
    // che non esiste.
    expect(resolveNameChange({ declared: null, fareType: null, operator: null }))
      .toEqual({ allowed: null, source: null });
    expect(resolveNameChange({ declared: null, fareType: "Tariffa ignota", operator: "Trenitalia" }))
      .toEqual({ allowed: null, source: null });
  });
});
