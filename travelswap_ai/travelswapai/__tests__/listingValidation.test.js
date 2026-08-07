// Le regole che decidono se un annuncio si può pubblicare.
//
// Nascono da una matrice di test su "Crea annuncio" in cui ogni caso è stato
// provato davvero, alcuni contro un Postgres vero ricostruito dalle
// migration. Due sono passati da "ipotesi" a "difetto riprodotto": il prezzo
// a zero e il prezzo fuori scala, che qui passavano e a DB no.
//
// Il criterio di ogni caso è lo stesso: se questo controllo non c'è, che cosa
// vede l'utente? Se la risposta è "un errore di database", il controllo va
// qui.
import { computeListingErrors, CAMPI_STEP_1, MAX_PRICE, hasTooManyDecimals } from "../lib/listingValidation.mjs";

// Il traduttore vero non serve: interessa QUALE campo è in errore, non come
// è scritto il messaggio. Restituendo la chiave si legge meglio nei fallimenti.
const t = (k) => k;

const TRENO = {
  type: "train",
  cercoVendo: "VENDO",
  title: "Roma → Milano",
  routeFrom: "Roma",
  routeTo: "Milano",
  departAt: "2027-05-10T08:00",
  arriveAt: "2027-05-10T11:30",
  price: "45",
  location: "",
  checkIn: "",
  checkOut: "",
};

const HOTEL = {
  type: "hotel",
  cercoVendo: "VENDO",
  title: "Hotel a Roma",
  location: "Roma",
  checkIn: "2027-05-10",
  checkOut: "2027-05-13",
  price: "120",
  routeFrom: "",
  routeTo: "",
  departAt: "",
  arriveAt: "",
};

const err = (form, extra = {}) =>
  computeListingErrors({ form: { ...form, ...extra }, mode: "create", t, now: new Date("2027-01-01T10:00:00") });

describe("annuncio valido", () => {
  it("un treno completo non ha errori", () => {
    expect(err(TRENO)).toEqual({});
  });
  it("un hotel completo non ha errori", () => {
    expect(err(HOTEL)).toEqual({});
  });
});

describe("prezzo", () => {
  it("zero è rifiutato, e lo dice il campo prezzo", () => {
    // DIFETTO RIPRODOTTO. Qui passava (si bloccava solo il negativo), ma a DB
    // c'è chk_listings_price_positive CHECK (price > 0): l'INSERT veniva
    // rifiutato DOPO la verifica AI, con un "Impossibile pubblicare" che non
    // nominava il campo. Verificato su Postgres vero ricostruito dalle
    // migration: "violates check constraint chk_listings_price_positive".
    expect(err(TRENO, { price: "0" }).price).toBe("createListing.errors.priceZero");
    expect(err(TRENO, { price: "0,00" }).price).toBe("createListing.errors.priceZero");
  });

  it("oltre il massimo di numeric(10,2) è rifiutato qui, non da Postgres", () => {
    // DIFETTO RIPRODOTTO: listings.price è numeric(10,2). Sopra questa soglia
    // il database risponde "numeric field overflow", che finiva all'utente
    // come "Impossibile pubblicare l'annuncio".
    expect(err(TRENO, { price: "100000000" }).price).toBe("createListing.errors.priceTooHigh");
    expect(err(TRENO, { price: String(MAX_PRICE) })).toEqual({});
  });

  it("negativo, vuoto e non numerico restano rifiutati", () => {
    expect(err(TRENO, { price: "-10" }).price).toBe("createListing.errors.priceNegative");
    expect(err(TRENO, { price: "" }).price).toBe("createListing.errors.priceRequired");
    expect(err(TRENO, { price: "abc" }).price).toBe("createListing.errors.priceInvalid");
  });

  it("più di due decimali è rifiutato: l'euro ne ha due", () => {
    // Il separatore delle migliaia NON esiste in questo campo: "1,234" e
    // "1.234" valgono un euro e 234 millesimi. Il problema è che
    // listings.price è numeric(10,2), quindi il terzo decimale sparisce
    // arrotondando — verificato su Postgres: 1.234 → 1.23, 1.235 → 1.24.
    // Chi scriveva "1,234" pensando a milleduecentotrentaquattro euro vedeva
    // quel numero nel campo e pubblicava un annuncio da 1,23 €.
    expect(err(TRENO, { price: "1,234" }).price).toBe("createListing.errors.priceDecimals");
    expect(err(TRENO, { price: "1.234" }).price).toBe("createListing.errors.priceDecimals");
    // Vale per tutti e tre i campi in euro: stessa colonna, stesso taglio.
    expect(err(TRENO, { price: "40", purchasePrice: "50,123" }).purchasePrice)
      .toBe("createListing.errors.priceDecimals");
    expect(err(TRENO, { dynamicPricingEnabled: true, price: "40", priceFloor: "20,123" }).priceFloor)
      .toBe("createListing.errors.priceDecimals");
  });

  it("il numero attaccato resta il modo di scrivere le migliaia", () => {
    // La regola decisa: 1234 euro si scrive tutto attaccato.
    expect(err(TRENO, { price: "1234" })).toEqual({});
    expect(err(TRENO, { price: "1234,50" })).toEqual({});
  });

  it("hasTooManyDecimals guarda le cifre scritte, non il numero", () => {
    // Sul numero convertito non si può contare: 1.234 in virgola mobile è
    // indistinguibile da tanti valori vicini. Il testo battuto invece dice
    // esattamente quante cifre sono state scritte.
    expect(hasTooManyDecimals("1,234")).toBe(true);
    expect(hasTooManyDecimals("1.234")).toBe(true);
    expect(hasTooManyDecimals("49,90")).toBe(false);
    expect(hasTooManyDecimals("1234")).toBe(false);
    expect(hasTooManyDecimals("1.234,56")).toBe(false); // due decimali dopo l'ultimo separatore
    expect(hasTooManyDecimals("50")).toBe(false);
    expect(hasTooManyDecimals("")).toBe(false);
    expect(hasTooManyDecimals(null)).toBe(false);
    expect(hasTooManyDecimals("49,90 €")).toBe(false);
  });

  it("i formati che una persona scrive davvero passano", () => {
    expect(err(TRENO, { price: "49,90" })).toEqual({});
    expect(err(TRENO, { price: "€50" })).toEqual({});
    expect(err(TRENO, { price: " 45 " })).toEqual({});
  });

  it("il prezzo di vendita non supera quello di acquisto", () => {
    expect(err(TRENO, { price: "80", purchasePrice: "50" }).price)
      .toBe("createListing.errors.priceAbovePurchase");
    expect(err(TRENO, { price: "40", purchasePrice: "50" })).toEqual({});
  });

  it("su un CERCO il prezzo è un budget: nessuna regola da venditore", () => {
    // Un CERCO non ha un prezzo d'acquisto né un prezzo dinamico: applicargli
    // l'anti-bagarinaggio significherebbe rifiutare un tetto di spesa.
    const cerco = { ...TRENO, cercoVendo: "CERCO", price: "200", purchasePrice: "50", dynamicPricingEnabled: true, priceFloor: "" };
    expect(err(cerco)).toEqual({});
  });
});

describe("prezzo dinamico", () => {
  it("il minimo è obbligatorio se il dinamico è attivo", () => {
    expect(err(TRENO, { dynamicPricingEnabled: true, priceFloor: "" }).priceFloor)
      .toBe("createListing.errors.priceFloorRequired");
  });
  it("il minimo non può superare il prezzo", () => {
    expect(err(TRENO, { dynamicPricingEnabled: true, price: "40", priceFloor: "50" }).priceFloor)
      .toBe("createListing.errors.priceFloorAbovePrice");
  });
  it("minimo uguale al prezzo è ammesso: la curva è piatta, non salita", () => {
    expect(err(TRENO, { dynamicPricingEnabled: true, price: "40", priceFloor: "40" })).toEqual({});
  });
});

describe("date", () => {
  it("arrivo uguale alla partenza non è un viaggio", () => {
    // Stesso confronto stretto del vincolo DB chk_listings_train_dates_order,
    // verificato su Postgres vero: senza questo il messaggio sarebbe suo.
    expect(err(TRENO, { arriveAt: TRENO.departAt }).arriveAt)
      .toBe("createListing.errors.arriveBeforeDepart");
  });
  it("check-out uguale al check-in è zero notti", () => {
    expect(err(HOTEL, { checkOut: HOTEL.checkIn }).checkOut)
      .toBe("createListing.errors.checkoutBeforeCheckin");
  });
  it("una data inesistente non passa", () => {
    expect(err(HOTEL, { checkIn: "2027-02-31" }).checkIn).toBe("createListing.errors.checkInInvalid");
  });
  it("in CREAZIONE il passato blocca", () => {
    expect(err(TRENO, { departAt: "2026-01-01T08:00", arriveAt: "2026-01-01T11:00" }).departAt)
      .toBe("createListing.checkAi.localDepartPast");
  });
  it("in MODIFICA il passato NON blocca: si deve poter correggere il prezzo", () => {
    const passato = { ...TRENO, departAt: "2026-01-01T08:00", arriveAt: "2026-01-01T11:00" };
    const e = computeListingErrors({ form: passato, mode: "edit", t, now: new Date("2027-01-01T10:00:00") });
    expect(e).toEqual({});
  });
  it("il formato italiano della data viene normalizzato, non rifiutato", () => {
    expect(err(HOTEL, { checkIn: "10/05/2027", checkOut: "13/05/2027" })).toEqual({});
  });
});

describe("biglietto nominativo", () => {
  it("senza genere non si pubblica", () => {
    expect(err(TRENO, { isNamedTicket: true, gender: "" }).gender)
      .toBe("createListing.errors.genderRequired");
  });
  it("con M o F si pubblica", () => {
    expect(err(TRENO, { isNamedTicket: true, gender: "F" })).toEqual({});
  });
});

describe("a quale passo riportare l'utente", () => {
  it("il genere NON manda allo step 1, perché il campo sta sullo step 2", () => {
    // DIFETTO RIPRODOTTO leggendo il codice: "gender" era nell'elenco dei
    // campi dello step 1, ma il selettore M/F è renderizzato sullo step 2,
    // sotto l'interruttore "biglietto nominativo". Chi premeva Pubblica con
    // il genere mancante veniva spedito allo step 1 — dove quel campo non
    // esiste — cioè esattamente il "non succede niente" che quel salto
    // doveva eliminare.
    expect(CAMPI_STEP_1).not.toContain("gender");
  });

  it("i campi dello step 1 ci sono tutti", () => {
    for (const campo of ["routeFrom", "routeTo", "location", "checkIn", "checkOut", "departAt", "arriveAt"]) {
      expect(CAMPI_STEP_1).toContain(campo);
    }
  });

  it("nessun campo dello step 2 è nell'elenco", () => {
    for (const campo of ["price", "purchasePrice", "priceFloor", "gender"]) {
      expect(CAMPI_STEP_1).not.toContain(campo);
    }
  });
});

describe("campi obbligatori", () => {
  it("treno senza tratta", () => {
    const e = err(TRENO, { routeFrom: "", routeTo: "" });
    expect(e.routeFrom).toBe("createListing.errors.routeFromRequired");
    expect(e.routeTo).toBe("createListing.errors.routeToRequired");
  });
  it("hotel senza località", () => {
    expect(err(HOTEL, { location: "" }).location).toBe("createListing.errors.locationRequired");
  });
  it("senza titolo", () => {
    expect(err(TRENO, { title: "  " }).title).toBe("createListing.errors.titleRequired");
  });
});
