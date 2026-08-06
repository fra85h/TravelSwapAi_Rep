// Il riepilogo prima di pubblicare: quando compare e quando NON deve.
//
// Il rischio di questa funzionalità non è che dimentichi un avviso: è che ne
// mostri troppi. Un box che appare sempre diventa un tasto OK da premere a
// occhi chiusi, e a quel punto non protegge più niente — nemmeno le
// conferme serie, tipo "elimina", che è terminale.
//
// Quindi il test più importante qui è il primo: annuncio a posto, elenco
// vuoto, nessuna interruzione.
import { publishReviewItems, REVIEW, LOW_TRUST_THRESHOLD } from "../lib/publishReview.mjs";

const ANNUNCIO_A_POSTO = {
  photoCount: 2,
  trustScore: 88,
  priceHint: null,
  dynamicPricingEnabled: false,
  priceFloor: null,
};

const codici = (ctx) => publishReviewItems(ctx).map((i) => i.code);

describe("riepilogo prima di pubblicare", () => {
  it("annuncio a posto: nessun box, si pubblica e basta", () => {
    expect(publishReviewItems(ANNUNCIO_A_POSTO)).toEqual([]);
  });

  it("senza foto lo dice", () => {
    expect(codici({ ...ANNUNCIO_A_POSTO, photoCount: 0 })).toEqual([REVIEW.NO_PHOTOS]);
  });

  it("affidabilità bassa: mostra il numero, che è ciò che vedranno gli altri", () => {
    const items = publishReviewItems({ ...ANNUNCIO_A_POSTO, trustScore: 42 });
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe(REVIEW.LOW_TRUST);
    expect(items[0].params.score).toBe(42);
  });

  it("nessun punteggio NON è punteggio basso: sono due avvisi diversi", () => {
    // "esce senza badge" e "esce con 42%" sono due situazioni che l'utente
    // affronta in modo diverso: la prima si rimedia rilanciando la verifica,
    // la seconda migliorando l'annuncio.
    expect(codici({ ...ANNUNCIO_A_POSTO, trustScore: null })).toEqual([REVIEW.NO_TRUST]);
    expect(codici({ ...ANNUNCIO_A_POSTO, trustScore: undefined })).toEqual([REVIEW.NO_TRUST]);
    expect(codici({ ...ANNUNCIO_A_POSTO, trustScore: "non-un-numero" })).toEqual([REVIEW.NO_TRUST]);
  });

  it("sulla soglia esatta non avvisa: 60 è già abbastanza", () => {
    expect(codici({ ...ANNUNCIO_A_POSTO, trustScore: LOW_TRUST_THRESHOLD })).toEqual([]);
    expect(codici({ ...ANNUNCIO_A_POSTO, trustScore: LOW_TRUST_THRESHOLD - 1 })).toEqual([REVIEW.LOW_TRUST]);
  });

  it("un punteggio ALTO non produce nessun avviso, nemmeno per scrupolo", () => {
    expect(codici({ ...ANNUNCIO_A_POSTO, trustScore: 100 })).toEqual([]);
  });

  it("prezzo sopra la stima: passa la percentuale se c'è", () => {
    const items = publishReviewItems({ ...ANNUNCIO_A_POSTO, priceHint: { pct: 40 } });
    expect(items[0].code).toBe(REVIEW.PRICE_HIGH);
    expect(items[0].params.pct).toBe(40);
  });

  it("prezzo alto senza percentuale: avvisa lo stesso, senza numero inventato", () => {
    const items = publishReviewItems({ ...ANNUNCIO_A_POSTO, priceHint: { pct: null } });
    expect(items[0].code).toBe(REVIEW.PRICE_HIGH);
    expect(items[0].params.pct).toBeUndefined();
  });

  it("prezzo dinamico: è l'avviso su una cosa che succederà DOPO, da sola", () => {
    // Il toggle vive nelle opzioni avanzate: si attiva e ci si dimentica.
    // Senza questo avviso, il prezzo comincia a scendere e nessuno lo ha
    // deciso di recente.
    const items = publishReviewItems({ ...ANNUNCIO_A_POSTO, dynamicPricingEnabled: true, priceFloor: 25 });
    expect(items[0].code).toBe(REVIEW.DYNAMIC_PRICING);
    expect(items[0].params.floor).toBe(25);
  });

  it("prezzo dinamico senza minimo valido: avvisa senza cifra", () => {
    const items = publishReviewItems({ ...ANNUNCIO_A_POSTO, dynamicPricingEnabled: true, priceFloor: NaN });
    expect(items[0].code).toBe(REVIEW.DYNAMIC_PRICING);
    expect(items[0].params.floor).toBeUndefined();
  });

  it("più problemi insieme: tutti elencati, in ordine stabile", () => {
    // L'ordine conta per chi legge: prima cosa manca all'annuncio, poi cosa
    // succederà da solo.
    expect(codici({
      photoCount: 0,
      trustScore: 30,
      priceHint: { pct: 50 },
      dynamicPricingEnabled: true,
      priceFloor: 10,
    })).toEqual([REVIEW.NO_PHOTOS, REVIEW.LOW_TRUST, REVIEW.PRICE_HIGH, REVIEW.DYNAMIC_PRICING]);
  });

  it("senza argomenti non esplode e non inventa avvisi a caso", () => {
    // Chiamata difensiva: deve dire ciò che sa (niente foto, niente
    // punteggio), non tutto.
    expect(codici()).toEqual([REVIEW.NO_PHOTOS, REVIEW.NO_TRUST]);
  });

  it("ogni voce porta un'icona: il box le mostra, non deve restare vuota", () => {
    const items = publishReviewItems({ photoCount: 0, trustScore: 10, dynamicPricingEnabled: true, priceFloor: 5 });
    items.forEach((i) => expect(typeof i.icon).toBe("string"));
    items.forEach((i) => expect(i.icon.length).toBeGreaterThan(0));
  });
});
