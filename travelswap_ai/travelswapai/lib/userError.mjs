// Da un errore qualsiasi a due frasi che una persona può usare.
//
// Il problema che risolve: in tutta l'app l'avviso di errore era
// `Alert.alert("Errore", e?.message || String(e))` — un titolo che non dice
// cosa è andato storto e un corpo che, quando l'errore non era nostro,
// mostrava testo scritto per i log: "Network request failed", "HTTP 502: Bad
// Gateway", "JSON Parse error", o "Error" secco quando il messaggio era
// vuoto. Chi lo legge non impara niente e soprattutto non sa cosa fare.
//
// Le tre regole che segue:
//
//   1. Il titolo dice COSA non è riuscito, non "Errore". Lo passa chi
//      chiama, perché solo lì si sa: "Proposta non inviata" è un titolo,
//      "Errore" è un'etichetta.
//   2. Il corpo dice COSA FARE. Un messaggio che non suggerisce un'azione
//      lascia l'utente esattamente dov'era.
//   3. Il dettaglio tecnico non si butta: finisce in coda fra parentesi,
//      dove non disturba chi non lo capisce e serve a chi ce lo segnala.

import { isNetworkError } from "./connectivity";

/** Il messaggio grezzo, senza gli "Error" vuoti di String(new Error("")). */
function grezzo(err) {
  const m = (typeof err?.message === "string" && err.message.trim())
    || (typeof err === "string" && err.trim())
    || "";
  return m === "Error" ? "" : m;
}

const TIMEOUT_RE = /^Timeout dopo (\d+)ms/;

/**
 * @param {unknown} err
 * @param {{ titolo?: string, azione?: string, t?: Function }} opts
 *   titolo: cosa non è riuscito, dal punto di vista dell'utente.
 *   azione: cosa può fare adesso; se manca, se ne sceglie una sensata.
 * @returns {{ title: string, message: string }}
 */
export function userError(err, opts = {}) {
  const t = typeof opts.t === "function" ? opts.t : (k, d) => d;
  const raw = grezzo(err);

  // Rete assente: è il caso più frequente e l'unico in cui l'utente può
  // davvero risolvere da solo. Merita un messaggio suo, non "riprova".
  if (isNetworkError(err)) {
    return {
      title: opts.titolo || t("common.offlineTitle", "Non riesco a caricare"),
      message: t("common.errNetwork", "Sembra che tu sia offline. Controlla la connessione e riprova: non è andato perso nulla."),
    };
  }

  const timeout = raw.match(TIMEOUT_RE);
  if (timeout) {
    const sec = Math.max(1, Math.round(Number(timeout[1]) / 1000));
    return {
      title: opts.titolo || t("common.errSlowTitle", "Ci sta mettendo troppo"),
      message: t("common.errTimeout", `Nessuna risposta dopo ${sec} secondi. Riprova fra poco: se era già partita, non verrà duplicata.`, { sec }),
    };
  }

  // Messaggio del server (fetchJson accoda il corpo dopo " — "): è scritto
  // per l'utente, e va mostrato al posto del nostro generico.
  let dalServer = "";
  const sep = raw.indexOf(" — ");
  if (sep >= 0) {
    const coda = raw.slice(sep + 3).trim();
    try {
      const j = JSON.parse(coda);
      if (typeof j?.error === "string" && j.error.trim()) dalServer = j.error.trim();
    } catch { /* non era JSON: resta il grezzo */ }
  }

  const azione = opts.azione || t("common.errRetry", "Riprova fra poco.");
  const testo = dalServer || azione;

  // Il dettaglio tecnico solo se aggiunge qualcosa a ciò che stiamo già
  // dicendo: ripetere due volte la stessa frase è peggio che non darla.
  const dettaglio = raw && raw !== testo && !dalServer ? ` (${raw.slice(0, 120)})` : "";

  return {
    title: opts.titolo || t("common.errGenericTitle", "Non ha funzionato"),
    message: `${testo}${dettaglio}`,
  };
}

/**
 * Scorciatoia per il caso più comune: `Alert.alert(...alertArgs(e, {...}))`.
 * @returns {[string, string]}
 */
export function alertArgs(err, opts = {}) {
  const { title, message } = userError(err, opts);
  return [title, message];
}
