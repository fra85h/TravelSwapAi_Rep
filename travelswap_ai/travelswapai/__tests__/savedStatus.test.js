// Che cosa dice un annuncio salvato che non è più acquistabile.
//
// I Preferiti non filtrano per stato di proposito: un annuncio che sparisce
// in silenzio è peggio di uno marcato "Venduto". Ma l'elenco delle etichette
// copriva 4 stati sugli 11 dell'enum listing_status, e i sette che mancavano
// finivano tutti in un "Non disponibile" identico — compresi i tre che una
// persona ha davvero bisogno di distinguere: scaduto, eliminato e riservato.
import { statusLabel } from "../screens/SavedScreen";

// Restituisce la chiave: interessa QUALE etichetta esce, non come è scritta.
const t = (k) => k;

// Gli undici valori di public.listing_status, letti dal database
// ricostruito dalle migration.
const STATI = [
  "draft", "active", "paused", "sold", "exchanged", "archived",
  "expired", "deleted", "pending", "reserved", "swapped",
];

describe("etichetta di stato nei Preferiti", () => {
  it("un annuncio attivo non ha etichetta: è la normalità", () => {
    expect(statusLabel("active", t)).toBeNull();
    expect(statusLabel(null, t)).toBeNull();
    expect(statusLabel(undefined, t)).toBeNull();
  });

  it("nessuno stato reale cade più nel generico \"Non disponibile\"", () => {
    // È il difetto: sette stati su undici davano la stessa frase, che non
    // dice se l'annuncio può tornare disponibile o è finito per sempre.
    const generici = STATI
      .filter((s) => s !== "active")
      .filter((s) => statusLabel(s, t) === "savedScreen.statusUnavailable");
    expect(generici).toEqual([]);
  });

  it("i tre stati che contano hanno una frase che spiega cosa è successo", () => {
    expect(statusLabel("expired", t)).toBe("savedScreen.statusExpired");
    expect(statusLabel("deleted", t)).toBe("savedScreen.statusDeleted");
    expect(statusLabel("reserved", t)).toBe("savedScreen.statusReserved");
  });

  it("swapped ed exchanged dicono la stessa cosa", () => {
    // Nell'enum convivono entrambi; per chi legge sono lo stesso evento.
    expect(statusLabel("swapped", t)).toBe(statusLabel("exchanged", t));
  });

  it("uno stato sconosciuto non rompe niente", () => {
    // Se domani l'enum cresce, meglio una frase generica che una schermata
    // vuota: il test qui sopra si accorgerà comunque della novità.
    expect(statusLabel("qualcosa_di_nuovo", t)).toBe("savedScreen.statusUnavailable");
  });
});
