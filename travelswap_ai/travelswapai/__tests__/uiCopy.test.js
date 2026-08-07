// I testi che l'utente legge non devono nominare i pezzi del sistema.
//
// Nasce da una riga trovata in un audit: "Backend offline o non
// raggiungibile", mostrata a chi voleva solo sapere che fine avessero fatto
// i suoi suggerimenti. Parla di un componente che l'utente non sa di avere,
// non dice cosa è successo alle SUE cose e non dice cosa fare.
//
// È il genere di frase che rientra da sola: si scrive in fretta quando si sta
// debuggando, e nessuno la rilegge più. Questo test la intercetta in tutte e
// tre le lingue.
import { translations as T } from "../lib/i18n/translations";
const LINGUE = Object.keys(T).filter((l) => T[l] && typeof T[l] === "object");

/** Tutte le stringhe del dizionario, con il loro percorso. */
function appiattisci(obj, prefisso = "") {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const path = prefisso ? `${prefisso}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...appiattisci(v, path));
    else if (typeof v === "string") out.push([path, v]);
  }
  return out;
}

// Parole che descrivono l'implementazione, non l'esperienza. Cercate come
// parole intere: "server" no, "osservare" sì.
const GERGO = [
  /\bbackend\b/i,
  /\bendpoint\b/i,
  /\bpayload\b/i,
  /\btoken\b/i,      // il codice Messenger è un "codice", non un token
  /\bJSON\b/,
  /\bnull\b/i,
  /\bundefined\b/i,
  /\bRPC\b/,
  /\bHTTP\s?\d{3}\b/,
];

// Eccezioni motivate: testi che l'utente NON legge come messaggio d'errore.
const AMMESSE = new Set([
  "legal.privacyBody",   // documento legale: lì "token" e simili sono termini propri
  "legal.termsBody",
]);

describe("i testi dell'interfaccia parlano all'utente", () => {
  for (const lingua of LINGUE) {
    it(`${lingua}: nessuna stringa nomina i pezzi del sistema`, () => {
      const colpevoli = appiattisci(T[lingua])
        .filter(([path]) => !AMMESSE.has(path))
        .filter(([, testo]) => GERGO.some((re) => re.test(testo)))
        .map(([path, testo]) => `${path}: "${testo.slice(0, 80)}"`);

      expect(colpevoli).toEqual([]);
    });
  }

  it("le tre lingue hanno le stesse chiavi", () => {
    // Una chiave che esiste solo in italiano non è un dettaglio: chi usa
    // l'app in inglese vede comparire una frase italiana in mezzo al resto.
    const insiemi = LINGUE.map((l) => new Set(appiattisci(T[l]).map(([p]) => p)));
    const [primo] = insiemi;
    for (let i = 1; i < insiemi.length; i++) {
      const mancanti = [...primo].filter((k) => !insiemi[i].has(k));
      const inPiu = [...insiemi[i]].filter((k) => !primo.has(k));
      expect({ lingua: LINGUE[i], mancanti, inPiu }).toEqual({ lingua: LINGUE[i], mancanti: [], inPiu: [] });
    }
  });

  it("nessun messaggio d'errore si ferma alla parola \"Errore\"", () => {
    // "Errore" è un'etichetta, non un messaggio: non dice cosa è successo
    // né cosa fare. Se una stringa è ESATTAMENTE quella, e non è il titolo
    // generico comune, qualcosa manca.
    const soloEtichetta = new Set(["common.error", "common.errorTitle"]);
    for (const lingua of LINGUE) {
      const colpevoli = appiattisci(T[lingua])
        .filter(([path, testo]) => !soloEtichetta.has(path) && /^(errore|error|fallito|failed)\.?$/i.test(testo.trim()))
        .map(([path]) => `${lingua}:${path}`);
      expect(colpevoli).toEqual([]);
    }
  });
});
