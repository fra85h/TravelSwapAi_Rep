// Sei online? — un solo posto che lo sa, per tutta l'app.
//
// Prima non lo sapeva nessuno: in tutto il codice "offline" compariva tre
// volte, e nessuna delle tre era un rilevamento (un parametro OAuth,
// un'icona, un catch vuoto). Senza rete ogni elenco mostrava il suo vuoto —
// "Nessun annuncio salvato", "Nessuna notifica" — e quel messaggio, che
// dovrebbe dire "non hai nulla", diceva una cosa falsa: le cose ci sono,
// non siamo riusciti a leggerle.
//
// COME LO SAPPIAMO, senza aggiungere librerie native. Due fonti, che
// insieme coprono i casi reali:
//
//   1. Il browser, dove c'è: `navigator.onLine` più gli eventi online/
//      offline. Su react-native-web è la verità immediata; su iOS/Android
//      quell'oggetto non esiste e questa fonte semplicemente tace.
//
//   2. Gli errori delle nostre stesse richieste. È la fonte che vale su
//      tutte le piattaforme, ed è anche la più onesta: per chi usa l'app
//      "offline" non significa "la scheda di rete è spenta", significa "le
//      richieste non passano". Un wi-fi collegato a un router senza
//      internet è offline a tutti gli effetti pratici, e `navigator.onLine`
//      direbbe di sì.
//
// Non aggiunge dipendenze di proposito: NetInfo o expo-network sono moduli
// nativi, e ognuno costringerebbe a una nuova build EAS per una cosa che si
// può sapere da ciò che l'app già fa.

let offline = false;
const listeners = new Set();

function emit() {
  for (const cb of listeners) {
    try { cb(offline); } catch { /* un ascoltatore rotto non ne blocca altri */ }
  }
}

function set(next) {
  if (offline === next) return;
  offline = next;
  emit();
}

/** Stato corrente. `true` = le richieste non stanno passando. */
export function isOffline() {
  return offline;
}

/**
 * Registra un ascoltatore. Ritorna la funzione per disiscriversi — da
 * chiamare nel cleanup dell'effetto, altrimenti ogni schermata smontata
 * lascia dietro un riferimento vivo.
 */
export function subscribeConnectivity(cb) {
  if (typeof cb !== "function") return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Una richiesta è fallita per la rete (non per un 4xx/5xx: quelli sono
 * risposte, e una risposta vuol dire che la rete c'è).
 */
export function reportNetworkFailure() {
  set(true);
}

/** Una richiesta è andata a buon fine: qualunque cosa fosse, è passata. */
export function reportNetworkSuccess() {
  set(false);
}

/**
 * L'errore di `fetch` quando la richiesta non parte proprio.
 *
 * In JS un fallimento di rete arriva come TypeError con messaggi diversi a
 * seconda del motore ("Failed to fetch" su Chrome, "Network request failed"
 * su Hermes, "Load failed" su Safari). Non c'è un codice: si riconoscono i
 * messaggi, e nel dubbio si dice di no — segnare offline un'app che non lo è
 * fa più danno che non segnarlo.
 */
export function isNetworkError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return false; // timeout nostro, non assenza di rete
  const msg = String(err.message || err).toLowerCase();
  return (
    err instanceof TypeError ||
    msg.includes("network request failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("network error") ||
    msg.includes("connection")
  );
}

// Fonte 1: il browser. Su nativo `navigator.onLine` è undefined e questo
// blocco non fa niente — non è un ripiego, è una fonte in più dove esiste.
if (typeof globalThis !== "undefined" && typeof globalThis.addEventListener === "function") {
  const nav = globalThis.navigator;
  if (nav && typeof nav.onLine === "boolean") {
    offline = !nav.onLine;
    globalThis.addEventListener("online", () => set(false));
    globalThis.addEventListener("offline", () => set(true));
  }
}
