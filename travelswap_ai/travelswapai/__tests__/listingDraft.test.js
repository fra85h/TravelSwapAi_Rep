// La bozza di "Crea annuncio" appartiene a chi la scrive.
//
// Prima stava sotto una chiave sola per tutto il dispositivo: chi entrava
// dopo un altro utente si trovava precompilati prezzo, tratta, date e
// descrizione di chi c'era prima. Questi test difendono il confine.
import {
  draftKey, readDraft, writeDraft, clearDraft, dropLegacyDraft, LEGACY_DRAFT_KEY,
} from "../lib/listingDraft.mjs";

/** AsyncStorage finto: la stessa forma (getItem/setItem/removeItem), in memoria. */
function memoria(iniziale = {}) {
  const dati = { ...iniziale };
  return {
    dati,
    getItem: async (k) => (k in dati ? dati[k] : null),
    setItem: async (k, v) => { dati[k] = v; },
    removeItem: async (k) => { delete dati[k]; },
  };
}

const ANNA = "11111111-1111-1111-1111-111111111111";
const BRUNO = "22222222-2222-2222-2222-222222222222";

describe("la bozza è intestata a chi la scrive", () => {
  it("due utenti sullo stesso dispositivo non si vedono", async () => {
    const s = memoria();
    await writeDraft(s, ANNA, { title: "Roma → Milano", price: "45" });
    expect(await readDraft(s, BRUNO)).toBeNull();
    expect((await readDraft(s, ANNA)).price).toBe("45");
  });

  it("ognuno ritrova la propria dopo un rientro", async () => {
    // È il vantaggio rispetto al cancellare tutto all'uscita: uscire non
    // costa più la bozza a cui si stava lavorando.
    const s = memoria();
    await writeDraft(s, ANNA, { title: "A" });
    await writeDraft(s, BRUNO, { title: "B" });
    expect((await readDraft(s, ANNA)).title).toBe("A");
    expect((await readDraft(s, BRUNO)).title).toBe("B");
  });

  it("cancellare la propria non tocca quella dell'altro", async () => {
    const s = memoria();
    await writeDraft(s, ANNA, { title: "A" });
    await writeDraft(s, BRUNO, { title: "B" });
    await clearDraft(s, ANNA);
    expect(await readDraft(s, ANNA)).toBeNull();
    expect((await readDraft(s, BRUNO)).title).toBe("B");
  });
});

describe("quando non si sa chi sia l'utente", () => {
  it("non si scrive niente", async () => {
    // Meglio perdere una bozza che scriverla dove la leggerà qualcun altro.
    const s = memoria();
    expect(await writeDraft(s, null, { title: "X" })).toBe(false);
    expect(Object.keys(s.dati)).toEqual([]);
  });

  it("non si legge niente", async () => {
    const s = memoria({ [LEGACY_DRAFT_KEY]: JSON.stringify({ title: "vecchia" }) });
    expect(await readDraft(s, null)).toBeNull();
    expect(await readDraft(s, "   ")).toBeNull();
  });

  it("la chiave non esiste", () => {
    expect(draftKey(null)).toBeNull();
    expect(draftKey("")).toBeNull();
    expect(draftKey(ANNA)).toBe(`${LEGACY_DRAFT_KEY}:${ANNA}`);
  });
});

describe("la bozza vecchia, senza intestazione", () => {
  it("viene buttata, non assegnata a nessuno", async () => {
    // Migrarla significherebbe darla al primo che apre l'app dopo
    // l'aggiornamento — cioè, nel caso che stiamo chiudendo, alla persona
    // sbagliata.
    const s = memoria({ [LEGACY_DRAFT_KEY]: JSON.stringify({ title: "di qualcuno" }) });
    await dropLegacyDraft(s);
    expect(s.dati[LEGACY_DRAFT_KEY]).toBeUndefined();
    expect(await readDraft(s, ANNA)).toBeNull();
    expect(await readDraft(s, BRUNO)).toBeNull();
  });
});

describe("robustezza", () => {
  it("una bozza illeggibile non è un guasto", async () => {
    // Non deve impedire di creare un annuncio nuovo.
    const s = memoria({ [draftKey(ANNA)]: "{ questo non è JSON" });
    expect(await readDraft(s, ANNA)).toBeNull();
  });

  it("un contenuto che non è un oggetto viene ignorato", async () => {
    const s = memoria({ [draftKey(ANNA)]: JSON.stringify(["a", "b"]) });
    expect(await readDraft(s, ANNA)).toBeNull();
  });

  it("uno storage che esplode non fa cadere la schermata", async () => {
    const rotto = {
      getItem: async () => { throw new Error("disco pieno"); },
      setItem: async () => { throw new Error("disco pieno"); },
      removeItem: async () => { throw new Error("disco pieno"); },
    };
    await expect(readDraft(rotto, ANNA)).resolves.toBeNull();
    await expect(writeDraft(rotto, ANNA, {})).resolves.toBe(false);
    await expect(clearDraft(rotto, ANNA)).resolves.toBeUndefined();
    await expect(dropLegacyDraft(rotto)).resolves.toBeUndefined();
  });
});
