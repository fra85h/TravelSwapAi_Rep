// Il bucket delle foto è pubblico: un file che nessun annuncio nomina resta
// comunque raggiungibile da chiunque abbia l'indirizzo.
//
// Su una foto di biglietto — con sopra nome, tratta e a volte il codice di
// prenotazione — questo conta. Erano due difetti speculari, entrambi
// nell'ORDINE delle due scritture:
//
//   * in caricamento: prima il file, poi la riga. Se la riga veniva
//     rifiutata (il trigger a DB non ne accetta più di due per annuncio) il
//     file restava caricato e senza padrone.
//   * in cancellazione: prima la riga, poi il file "best effort" dentro un
//     try/catch. Se il file non si toglieva, l'utente vedeva la foto sparire
//     dall'annuncio mentre l'immagine restava pubblica al suo indirizzo.
//
// Invertiti tutti e due, il caso peggiore diventa una riga senza file: una
// immagine rotta, che si vede e si corregge, invece di un documento che
// continua a circolare.

const mockUtente = "88888888-8888-4888-8888-888888888888";
const mockPassi = [];
let mockEsitoRiga;
let mockEsitoFile;

const mockRisposta = (data = null, error = null) => ({ data, error });

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: mockUtente } }, error: null }),
    },
    from: () => ({
      insert: (riga) => ({
        select: () => ({
          single: async () => {
            mockPassi.push({ op: "riga:insert", url: riga.url, position: riga.position });
            return mockEsitoRiga;
          },
        }),
      }),
      delete: () => ({
        eq: async () => {
          mockPassi.push({ op: "riga:delete" });
          return mockRisposta();
        },
      }),
    }),
    storage: {
      from: () => ({
        getPublicUrl: (p) => ({ data: { publicUrl: `https://cdn.example/listing-images/${p}` } }),
        upload: async () => {
          mockPassi.push({ op: "file:upload" });
          return mockEsitoFile;
        },
        remove: async () => {
          mockPassi.push({ op: "file:remove" });
          return mockEsitoFile;
        },
      }),
    },
  },
}));

const { uploadImage, deleteImage } = require("../lib/listingImages");

const foto = { base64: "aGVsbG8=", mimeType: "image/jpeg" };
const troppeFoto = { code: "P0001", message: "massimo 2 foto per annuncio" };

beforeEach(() => {
  mockPassi.length = 0;
  mockEsitoRiga = mockRisposta({ id: "img-1", url: "https://cdn.example/listing-images/x.jpg", position: 0 });
  mockEsitoFile = mockRisposta();
});

describe("caricamento", () => {
  it("registra la riga prima di caricare il file", async () => {
    await uploadImage("listing-1", foto, 0);
    expect(mockPassi.map((p) => p.op)).toEqual(["riga:insert", "file:upload"]);
  });

  it("se l'annuncio ha già due foto, nessun byte viene caricato", async () => {
    // Il caso concreto: il rifiuto arriva PRIMA del caricamento, quindi non
    // resta nessun file orfano — e non si spreca nemmeno la banda.
    mockEsitoRiga = mockRisposta(null, troppeFoto);
    await expect(uploadImage("listing-1", foto, 2)).rejects.toMatchObject({ message: /massimo 2/ });
    expect(mockPassi.map((p) => p.op)).toEqual(["riga:insert"]);
  });

  it("se il caricamento fallisce, la riga viene tolta", async () => {
    // Il caso opposto: al più resta un'immagine rotta per un istante, mai un
    // file senza padrone.
    mockEsitoFile = mockRisposta(null, { message: "rete" });
    await expect(uploadImage("listing-1", foto)).rejects.toBeTruthy();
    expect(mockPassi.map((p) => p.op)).toEqual(["riga:insert", "file:upload", "riga:delete"]);
  });
});

describe("cancellazione", () => {
  const url = "https://cdn.example/listing-images/utente/annuncio/123-abc.jpg";

  it("toglie il file prima della riga", async () => {
    await deleteImage("img-1", url);
    expect(mockPassi.map((p) => p.op)).toEqual(["file:remove", "riga:delete"]);
  });

  it("se il file non si toglie, la riga resta e l'errore arriva a chi ha premuto", async () => {
    // È il cuore del fix: prima la foto spariva dalla schermata e il file
    // restava pubblico, in silenzio.
    mockEsitoFile = mockRisposta(null, { message: "storage non raggiungibile" });
    await expect(deleteImage("img-1", url)).rejects.toMatchObject({ message: /storage/ });
    expect(mockPassi.map((p) => p.op)).toEqual(["file:remove"]);
  });

  it("senza un indirizzo riconoscibile si toglie comunque la riga", async () => {
    // Non c'è un file da rimuovere, o non sappiamo quale: lasciare la riga
    // renderebbe impossibile liberarsene.
    await deleteImage("img-1", "https://altrodominio.example/qualcosa.jpg");
    expect(mockPassi.map((p) => p.op)).toEqual(["riga:delete"]);
  });
});
