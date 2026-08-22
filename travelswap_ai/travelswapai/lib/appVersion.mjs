// "Questa versione dell'app è troppo vecchia per continuare?"
//
// Non esiste un canale di aggiornamento OTA: ogni correzione passa dallo
// store, e una versione già installata resta installata finché chi ce l'ha
// non decide di aggiornarla. Intanto il database va avanti — negli ultimi
// giorni si è irrigidito parecchio, con vincoli che rifiutano forme di
// annuncio che prima passavano — e un'app di due mesi fa continua a parlarci
// senza saperlo, raccogliendo errori grezzi che non sa spiegare.
//
// Questa è la soglia: il server dichiara la versione minima che sa ancora
// servire, l'app la confronta con la propria e, se è indietro, lo dice invece
// di lasciare che l'utente sbatta contro rifiuti incomprensibili.
//
// DUE REGOLE, ed è per queste che il confronto sta qui, puro e testabile.
//
// 1. Nel dubbio si passa. Server irraggiungibile, risposta strana, versione
//    illeggibile: si va avanti. Una soglia che sbaglia blocca fuori TUTTI,
//    compresi quelli che potevano lavorare benissimo, e senza canale OTA per
//    correggere l'errore resterebbero fuori fino alla prossima release sullo
//    store. Il danno di un falso positivo è enormemente più grande di quello
//    di un falso negativo.
//
// 2. Si blocca solo se la versione è STRETTAMENTE minore della soglia. Uguale
//    passa: la soglia dice "da questa in su", non "dopo questa".

/** Le tre parti numeriche di una versione, oppure null se non si capisce. */
function pezzi(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Si accetta anche "1.2" o "1.2.3-beta.1": si guardano i numeri iniziali,
  // il resto è etichetta e non ordina niente di utile.
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/**
 * -1 se a < b, 0 se pari, 1 se a > b. null se una delle due è illeggibile:
 * chi chiama deve poter distinguere "più vecchia" da "non lo so".
 */
export function confrontaVersioni(a, b) {
  const pa = pezzi(a);
  const pb = pezzi(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/**
 * @param {string} versioneApp  quella che gira adesso
 * @param {string|null} soglia  la minima dichiarata dal server
 * @returns {boolean} vero SOLO se si è sicuri di essere indietro
 */
export function troppoVecchia(versioneApp, soglia) {
  if (soglia == null || String(soglia).trim() === "") return false; // soglia non impostata: nessun blocco
  return confrontaVersioni(versioneApp, soglia) === -1;
}
