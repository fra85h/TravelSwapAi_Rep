// Salvare una modifica non deve annullare in silenzio quella di qualcun altro.
//
// Il salvataggio in "Modifica annuncio" manda TUTTI i campi del modulo, non
// solo quelli toccati. Finché non c'era un confronto di versione, correggere
// una virgola nella descrizione riscriveva anche il prezzo com'era
// all'apertura della schermata — e nel frattempo il decadimento automatico
// poteva averlo abbassato, con la notifica di ribasso già partita a chi
// aveva salvato l'annuncio. Chi salvava non lo sapeva, e nemmeno chi leggeva.
//
// Il fix non è impedire il salvataggio: è accorgersene e dirlo. La scelta poi
// è di chi sta modificando.

const mockAnnuncioId = "99999999-9999-4999-8999-999999999999";
const mockPassi = [];
let mockRigaAggiornata;
let mockRigaCorrente;

const mockRisposta = (data = null, error = null) => ({ data, error });

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }),
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    from: () => ({
      update: (patch) => {
        const filtri = [];
        const catena = {
          eq: (col, val) => { filtri.push({ col, val }); return catena; },
          select: () => ({
            maybeSingle: async () => {
              mockPassi.push({ op: "update", patch, filtri });
              return mockRisposta(mockRigaAggiornata);
            },
          }),
        };
        return catena;
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            mockPassi.push({ op: "rilettura" });
            return mockRisposta(mockRigaCorrente);
          },
        }),
      }),
    }),
  },
}));

const { updateListing, CONFLITTO_VERSIONE } = require("../lib/db");

const VERSIONE = "2026-08-18T10:00:00.000Z";

beforeEach(() => {
  mockPassi.length = 0;
  mockRigaAggiornata = { id: mockAnnuncioId, price: 80, updated_at: "2026-08-18T11:00:00.000Z" };
  mockRigaCorrente = null;
});

describe("controllo di versione", () => {
  it("quando la versione combacia, si salva e basta", async () => {
    const out = await updateListing(mockAnnuncioId, { price: 80 }, { attesoUpdatedAt: VERSIONE });

    expect(out.error).toBeUndefined();
    expect(mockPassi.map((p) => p.op)).toEqual(["update"]);
    // Il confronto viaggia come filtro sulla stessa scrittura: non è una
    // lettura prima e una scrittura dopo, che lascerebbe aperta la finestra
    // che il controllo dovrebbe chiudere.
    expect(mockPassi[0].filtri).toContainEqual({ col: "updated_at", val: VERSIONE });
  });

  it("se nel frattempo è cambiato, lo dice invece di sovrascrivere", async () => {
    mockRigaAggiornata = null;                       // zero righe: il filtro sulla versione non ha trovato nulla
    mockRigaCorrente = { id: mockAnnuncioId, price: 70 }; // ma l'annuncio c'è ancora

    const out = await updateListing(mockAnnuncioId, { price: 80 }, { attesoUpdatedAt: VERSIONE });

    expect(out.error?.code).toBe(CONFLITTO_VERSIONE);
    // Il prezzo vero torna al chiamante: serve a scrivere "è sceso a 70€,
    // se salvi torna a 80€" invece di un generico "riprova".
    expect(out.error.corrente.price).toBe(70);
    expect(mockPassi.map((p) => p.op)).toEqual(["update", "rilettura"]);
  });

  it("zero righe e nessun annuncio non è un conflitto: è un annuncio che non c'è", async () => {
    // Le due cause vanno distinte perché solo una ha un seguito sensato da
    // proporre. "Non è tuo / non esiste" non si risolve salvando di nuovo.
    mockRigaAggiornata = null;
    mockRigaCorrente = null;

    const out = await updateListing(mockAnnuncioId, { price: 80 }, { attesoUpdatedAt: VERSIONE });

    expect(out.error?.code).toBeUndefined();
    expect(out.error?.message).toMatch(/No rows updated/);
  });

  it("senza versione attesa il comportamento è quello di prima", async () => {
    // È la via che usa "Salva le mie" dopo il conflitto, ed è anche quella
    // dei chiamanti che una versione non ce l'hanno (es. il pulsante
    // pausa/riattiva dal profilo, che tocca solo lo stato).
    const out = await updateListing(mockAnnuncioId, { status: "paused" });

    expect(out.error).toBeUndefined();
    expect(mockPassi[0].filtri.map((f) => f.col)).toEqual(["id"]);
  });

  it("con zero righe e nessuna versione non si fa la rilettura", async () => {
    mockRigaAggiornata = null;
    const out = await updateListing(mockAnnuncioId, { price: 80 });

    expect(out.error?.message).toMatch(/No rows updated/);
    expect(mockPassi.map((p) => p.op)).toEqual(["update"]);
  });
});
