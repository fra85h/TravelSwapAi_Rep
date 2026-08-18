// Un annuncio con PNR non deve MAI essere pubblico senza il suo PNR.
//
// Il PNR è il codice di prenotazione: da lui il database ricava un'impronta e
// l'indice ux_listings_live_pnr impedisce che due annunci vivi rivendano lo
// stesso biglietto. Un annuncio senza PNR non ha impronta, quindi da
// quell'indice non è nemmeno guardato.
//
// Il difetto era in savePnrSecret: l'errore veniva scritto in console e
// basta, "per non bloccare il flusso principale". Ma l'errore che arriva più
// spesso da lì è proprio il rifiuto di quell'indice — "questo biglietto è già
// in vendita" — e inghiottirlo significava pubblicare comunque l'annuncio che
// l'indice doveva fermare, dicendo all'utente "pubblicato". Due persone che
// vendono lo stesso posto, e nessuna avvisata.
//
// La disciplina, la stessa del percorso Messenger: nascere in pausa, scrivere
// il segreto, e diventare pubblico solo dopo.

const mockUtente = "88888888-8888-4888-8888-888888888888";
const mockAnnuncioId = "99999999-9999-4999-8999-999999999999";

// Ogni operazione che parte finisce qui, in ordine: è la sequenza che questi
// test verificano, non i singoli valori.
let mockPassi;
let mockEsitoSegreto;

const mockRisposta = (data = null, error = null) => ({ data, error });

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: mockUtente } } }, error: null }),
      getUser: async () => ({ data: { user: { id: mockUtente } }, error: null }),
    },
    from: (tabella) => ({
      insert: (righe) => {
        mockPassi.push({ op: "insert", tabella, status: righe?.[0]?.status });
        return { select: () => ({ single: async () => mockRisposta({ id: mockAnnuncioId, status: righe?.[0]?.status }) }) };
      },
      upsert: async (riga) => {
        mockPassi.push({ op: "upsert", tabella, pnr: riga?.pnr });
        return mockEsitoSegreto;
      },
      update: (patch) => {
        mockPassi.push({ op: "update", tabella, patch });
        return {
          eq: () => ({
            select: () => ({
              single: async () => mockRisposta({ id: mockAnnuncioId, ...patch }),
              maybeSingle: async () => mockRisposta({ id: mockAnnuncioId, ...patch }),
            }),
          }),
        };
      },
      delete: () => ({
        eq: async () => {
          mockPassi.push({ op: "delete", tabella });
          return mockRisposta();
        },
      }),
    }),
  },
}));

const { insertListing, updateListing } = require("../lib/db");

const datiAnnuncio = (extra = {}) => ({
  type: "train",
  title: "Roma → Milano",
  route_from: "Roma",
  route_to: "Milano",
  depart_at: "2026-08-05T09:00",
  arrive_at: "2026-08-05T12:00",
  price: 30,
  cerco_vendo: "VENDO",
  ...extra,
});

// Il rifiuto vero dell'indice, nella forma in cui arriva da PostgREST.
const bigliettoGiaInVendita = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "ux_listings_live_pnr"',
};

beforeEach(() => {
  mockPassi = [];
  mockEsitoSegreto = mockRisposta();
});

describe("pubblicazione di un annuncio con PNR", () => {
  it("nasce in pausa e diventa attivo solo a segreto scritto", async () => {
    const out = await insertListing(datiAnnuncio({ pnr: "ABC123" }));

    expect(mockPassi.map((p) => `${p.op} ${p.tabella}`)).toEqual([
      "insert listings",
      "upsert listing_secrets",
      "update listings",
    ]);
    // L'ordine è il punto: fra l'insert e l'upsert non esiste un istante in
    // cui l'annuncio è pubblico e senza impronta.
    expect(mockPassi[0].status).toBe("paused");
    expect(mockPassi[2].patch).toEqual({ status: "active" });
    expect(out.status).toBe("active");
  });

  it("se il biglietto è già in vendita, l'annuncio non resta online", async () => {
    mockEsitoSegreto = mockRisposta(null, bigliettoGiaInVendita);

    await expect(insertListing(datiAnnuncio({ pnr: "ABC123" }))).rejects.toMatchObject({
      message: expect.stringContaining("ux_listings_live_pnr"),
    });

    // La bozza viene rimossa e nessuno l'ha mai vista attiva.
    expect(mockPassi.map((p) => `${p.op} ${p.tabella}`)).toEqual([
      "insert listings",
      "upsert listing_secrets",
      "delete listings",
    ]);
  });

  it("l'errore arriva al chiamante, non alla console", async () => {
    // La regressione in una riga: prima questa promessa si risolveva.
    mockEsitoSegreto = mockRisposta(null, bigliettoGiaInVendita);
    await expect(insertListing(datiAnnuncio({ pnr: "ABC123" }))).rejects.toBeTruthy();
  });

  it("senza PNR il percorso resta quello di prima", async () => {
    // Nessun segreto da proteggere, nessuna ragione per due scritture: un
    // annuncio senza PNR non deve pagare il giro in più.
    const out = await insertListing(datiAnnuncio());
    expect(mockPassi.map((p) => `${p.op} ${p.tabella}`)).toEqual(["insert listings"]);
    expect(mockPassi[0].status).toBe("active");
    expect(out.status).toBe("active");
  });

  it("un annuncio che nasce già in pausa non viene ripubblicato per sbaglio", async () => {
    const out = await insertListing(datiAnnuncio({ pnr: "ABC123", status: "paused" }));
    expect(mockPassi.map((p) => `${p.op} ${p.tabella}`)).toEqual([
      "insert listings",
      "upsert listing_secrets",
    ]);
    expect(out.status).toBe("paused");
  });
});

describe("modifica di un annuncio con PNR", () => {
  it("il PNR si scrive per primo", async () => {
    await updateListing(mockAnnuncioId, { price: 25, pnr: "ABC123" });
    expect(mockPassi.map((p) => `${p.op} ${p.tabella}`)).toEqual([
      "upsert listing_secrets",
      "update listings",
    ]);
  });

  it("se il PNR è rifiutato, il resto dell'annuncio non viene toccato", async () => {
    // È il motivo dell'ordine: un rifiuto lascia l'annuncio com'era, invece
    // di aver già salvato prezzo e date e dover spiegare che metà è passata.
    mockEsitoSegreto = mockRisposta(null, bigliettoGiaInVendita);

    const out = await updateListing(mockAnnuncioId, { price: 25, pnr: "ABC123" });

    expect(out.error).toBeTruthy();
    expect(mockPassi.map((p) => `${p.op} ${p.tabella}`)).toEqual(["upsert listing_secrets"]);
  });

  it("togliere il PNR cancella il segreto", async () => {
    await updateListing(mockAnnuncioId, { pnr: null });
    expect(mockPassi.map((p) => `${p.op} ${p.tabella}`)).toEqual([
      "delete listing_secrets",
      "update listings",
    ]);
  });

  it("una modifica che non nomina il PNR non lo tocca", async () => {
    await updateListing(mockAnnuncioId, { price: 25 });
    expect(mockPassi.map((p) => `${p.op} ${p.tabella}`)).toEqual(["update listings"]);
  });
});
