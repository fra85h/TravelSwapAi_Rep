// Da un errore qualsiasi a due frasi che una persona può usare.
//
// Prima ogni guasto finiva in `Alert.alert("Errore", e?.message || String(e))`:
// un titolo che non dice cosa è successo e un corpo che, quando l'errore non
// era nostro, mostrava testo da log — "Network request failed", "HTTP 502",
// o "Error" secco. Questi test difendono le tre cose che rendono utile un
// messaggio d'errore: dire cosa non è riuscito, dire cosa fare, e non
// mentire su cosa è successo.
import { userError, alertArgs } from "../lib/userError.mjs";

describe("messaggi di errore per chi usa l'app", () => {
  it("assenza di rete: lo dice, e dice che non si è perso nulla", () => {
    // È il caso più frequente e l'unico che l'utente può risolvere da solo:
    // merita un messaggio suo, non un "riprova" generico.
    const out = userError(new TypeError("Network request failed"));
    expect(out.title).toMatch(/carica/i);
    expect(out.message).toMatch(/offline/i);
    expect(out.message).toMatch(/perso/i);
  });

  it("timeout: NON è offline, ed è un'altra frase", () => {
    // Confonderli manderebbe l'utente a controllare il wi-fi mentre il
    // problema è il server lento.
    const out = userError(new Error("Timeout dopo 45000ms: /ai/trustscore"));
    expect(out.title).not.toMatch(/offline/i);
    expect(out.message).toMatch(/45 secondi/);
    expect(out.message).toMatch(/duplicat/i);
  });

  it("il titolo di chi chiama vince: dice COSA non è riuscito", () => {
    const out = userError(new Error("boom"), { titolo: "Proposta non inviata" });
    expect(out.title).toBe("Proposta non inviata");
  });

  it("il messaggio del server passa all'utente al posto del nostro", () => {
    // fetchJson accoda il corpo dopo " — ": lì dentro c'è l'unica frase
    // scritta per una persona, e prima veniva buttata.
    const err = new Error('HTTP 400: Bad Request — {"ok":false,"error":"Hai già un annuncio identico attivo."}');
    const out = userError(err);
    expect(out.message).toContain("Hai già un annuncio identico attivo.");
    expect(out.message).not.toContain("HTTP 400");
  });

  it("senza niente di meglio, dice cosa fare", () => {
    const out = userError(new Error("boom"), { azione: "La proposta è rimasta in attesa." });
    expect(out.message).toContain("La proposta è rimasta in attesa.");
  });

  it("il dettaglio tecnico resta, ma in coda e fra parentesi", () => {
    // Serve a chi ce lo segnala; non deve essere la prima cosa che legge
    // chi voleva solo capire se riprovare.
    const out = userError(new Error("ECONNRESET"), { azione: "Riprova fra poco." });
    expect(out.message.startsWith("Riprova fra poco.")).toBe(true);
    expect(out.message).toContain("(ECONNRESET)");
  });

  it("un errore vuoto non diventa \"Error\"", () => {
    // `String(new Error(""))` dà "Error": una parola che all'utente non dice
    // niente e che finiva comunque nell'avviso.
    const out = userError(new Error(""), { azione: "Riprova." });
    expect(out.message).toBe("Riprova.");
    expect(out.message).not.toMatch(/\bError\b/);
  });

  it("non ripete due volte la stessa frase", () => {
    const out = userError(new Error("Riprova fra poco."), { azione: "Riprova fra poco." });
    expect(out.message).toBe("Riprova fra poco.");
  });

  it("alertArgs dà i due argomenti nell'ordine di Alert.alert", () => {
    const args = alertArgs(new TypeError("Failed to fetch"), { titolo: "Voto non registrato" });
    expect(Array.isArray(args)).toBe(true);
    expect(args).toHaveLength(2);
    expect(args[0]).toBe("Voto non registrato");
  });

  it("usa il traduttore quando c'è, senza rompersi quando manca", () => {
    const t = (k, d) => (k === "common.errNetwork" ? "TRADOTTO" : d);
    expect(userError(new TypeError("Failed to fetch"), { t }).message).toBe("TRADOTTO");
    expect(userError(new TypeError("Failed to fetch")).message).toMatch(/offline/i);
  });
});
