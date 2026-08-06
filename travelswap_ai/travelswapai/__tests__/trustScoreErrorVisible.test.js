// Una verifica che fallisce deve DIRLO, subito.
//
// Caso reale: importando un biglietto tutti i campi si riempivano tranne la
// descrizione (il documento non ne contiene una). Toccando "Check AI" non
// succedeva niente — nessun punteggio, nessun avviso, nessun errore — e per
// capirlo bisognava toccare il bottone una seconda volta.
//
// Il motivo non era il controllo, che funzionava: era che il chiamante
// leggeva `error` dallo stato di React subito dopo `evaluate`, cioè il
// valore del render PRECEDENTE, ancora null. `getLastError()` legge un ref
// e non ha quel ritardo. Questo test difende esattamente quella differenza:
// il messaggio deve essere disponibile nello stesso giro in cui il
// fallimento avviene.
jest.mock("../lib/backendApi", () => ({ fetchJson: jest.fn() }));

import { renderHook, act } from "@testing-library/react-native";
import { fetchJson } from "../lib/backendApi";
import { useTrustScore } from "../lib/useTrustScore";

const ANNUNCIO_SENZA_DESCRIZIONE = {
  type: "train",
  title: "Roma-->Milano",
  description: "",
  origin: "Roma Termini",
  destination: "Milano Centrale",
  price: "49",
};

describe("il motivo di un Check AI fallito è leggibile subito", () => {
  beforeEach(() => fetchJson.mockReset());

  it("descrizione mancante: evaluate torna null e il motivo è già disponibile", async () => {
    const { result } = renderHook(() => useTrustScore());

    let esito;
    let motivo;
    await act(async () => {
      esito = await result.current.evaluate(ANNUNCIO_SENZA_DESCRIZIONE);
      // Letto QUI, nello stesso giro: è il punto in cui il chiamante decide
      // se mostrare un avviso.
      motivo = result.current.getLastError();
    });

    expect(esito).toBeNull();
    expect(motivo).toMatch(/descrizione/i);
    // E la chiamata non è nemmeno partita: niente rete sprecata per una
    // richiesta che il server rifiuterebbe.
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("descrizione troppo corta: stessa cosa, la soglia è 10 caratteri", async () => {
    const { result } = renderHook(() => useTrustScore());

    let motivo;
    await act(async () => {
      await result.current.evaluate({ ...ANNUNCIO_SENZA_DESCRIZIONE, description: "corta" });
      motivo = result.current.getLastError();
    });

    expect(motivo).toMatch(/descrizione/i);
  });

  it("una verifica riuscita azzera il motivo precedente", async () => {
    // Altrimenti il primo fallimento sporcherebbe per sempre i tentativi
    // successivi, facendo comparire un avviso su una verifica andata bene.
    const { result } = renderHook(() => useTrustScore());

    await act(async () => {
      await result.current.evaluate(ANNUNCIO_SENZA_DESCRIZIONE);
    });
    expect(result.current.getLastError()).toBeTruthy();

    fetchJson.mockResolvedValueOnce({ trustScore: 82, flags: [], suggestedFixes: [] });
    let esito;
    await act(async () => {
      esito = await result.current.evaluate({
        ...ANNUNCIO_SENZA_DESCRIZIONE,
        description: "Biglietto acquistato per un viaggio poi annullato, posto lato finestrino.",
      });
    });

    expect(esito).toEqual(expect.objectContaining({ trustScore: 82 }));
    expect(result.current.getLastError()).toBeNull();
  });

  it("un errore di rete arriva anch'esso al chiamante, non solo la validazione", async () => {
    const { result } = renderHook(() => useTrustScore());
    fetchJson.mockRejectedValueOnce(new Error("HTTP 503: servizio non disponibile"));

    let motivo;
    await act(async () => {
      await result.current.evaluate({
        ...ANNUNCIO_SENZA_DESCRIZIONE,
        description: "Descrizione abbastanza lunga da superare il controllo locale.",
      });
      motivo = result.current.getLastError();
    });

    expect(motivo).toMatch(/503/);
  });

  it("reset() dimentica anche il motivo", async () => {
    const { result } = renderHook(() => useTrustScore());
    await act(async () => {
      await result.current.evaluate(ANNUNCIO_SENZA_DESCRIZIONE);
    });
    act(() => result.current.reset());
    expect(result.current.getLastError()).toBeNull();
  });
});
