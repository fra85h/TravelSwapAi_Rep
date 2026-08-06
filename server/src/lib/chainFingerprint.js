// server/src/lib/chainFingerprint.js — "è cambiato qualcosa dall'ultimo giro?"
//
// Il ricalcolo delle catene a 3 gira ogni 15 minuti, cioè 96 volte al
// giorno, e ogni volta ricostruisce il grafo dei desideri da zero — il che
// significa centinaia di chiamate a OpenAI. Se però dall'ultimo giro non è
// cambiato niente, il risultato è identico a quello di un quarto d'ora
// prima: con l'app ferma erano 96 ricalcoli uguali al giorno, pagati tutti.
//
// COSA CONTA COME CAMBIAMENTO. Gli ingressi del calcolo sono DUE, e il
// secondo è quello che si dimentica:
//
//   1. gli annunci attivi — ovvio: pubblicare, modificare, mettere in
//      pausa o eliminare cambia i cicli possibili;
//
//   2. le proposte di catena in sospeso — meno ovvio, e sbagliarlo
//      congelerebbe le catene proprio quando servono. Chi è già dentro una
//      catena viene ESCLUSO dai cicli nuovi: quando una catena scade o
//      viene completata quelle persone tornano disponibili, e da quel
//      momento esistono cicli che prima non c'erano — senza che nessuno
//      abbia toccato un solo annuncio.
//
// PERCHÉ NON BASTA `updated_at`. La prima versione guardava, per gli
// annunci, quanti fossero e quale fosse l'ultima modifica. Sembrava
// gratis — due aggregazioni invece di una lettura — ma qualsiasi UPDATE su
// `listings` sposta `updated_at`, anche uno che al grafo dei desideri non
// dice niente. Il decadimento automatico dei prezzi ne scrive uno ogni
// giro su ogni annuncio in scadenza: bastava quello per invalidare
// l'impronta ogni 15 minuti e ricalcolare tutto, a pagamento, senza che
// nulla di rilevante fosse cambiato.
//
// Quindi l'impronta si costruisce sui CAMPI che il grafo usa davvero —
// chi possiede cosa, di che tipo, da dove a dove, quando — leggendo le
// righe. È una query in più contro centinaia di chiamate a un modello: il
// confronto non è nemmeno vicino. E il prezzo, che al punteggio delle
// catene non partecipa, resta fuori.
import { createHash } from "node:crypto";

/**
 * Impronta stabile. Volutamente leggibile e non un hash unico: nei log
 * "333|a1b2c3~2|2026-08-05T19:00:00Z" dice subito QUALE dei due ingressi
 * si è mosso, mentre un digest solo non direbbe niente.
 *
 * @param {{count:number, digest?:string, lastChangeAt?:string|null}} listings
 * @param {{count:number, digest?:string, lastChangeAt?:string|null}} chains
 */
export function chainFingerprint(listings, chains) {
  const part = (x) => `${Number(x?.count ?? 0)}|${x?.digest ?? x?.lastChangeAt ?? "-"}`;
  return `${part(listings)}~${part(chains)}`;
}

// I campi che entrano nel grafo dei desideri, e SOLO quelli. Aggiungerne
// uno qui è obbligatorio quando il matching comincia a usarlo: se un campo
// conta per il punteggio ma non per l'impronta, cambiarlo non fa
// ricalcolare niente e la catena giusta non compare mai.
//
// `location` c'è perché routeOf() la usa come ripiego quando route_from/
// route_to sono vuote: due annunci identici tranne che lì darebbero grafi
// diversi.
function structuralLine(l) {
  return [
    l?.id, l?.user_id, l?.status, l?.type, l?.cerco_vendo,
    l?.route_from, l?.route_to, l?.location,
    l?.depart_at, l?.check_in,
    l?.accepts_swap, l?.swap_wanted,
  ].map((v) => (v == null ? "" : String(v))).join("|");
}

/**
 * Impronta degli annunci attivi a partire dalle righe già lette.
 *
 * Ordinata prima di digerire: l'ordine in cui il database restituisce le
 * righe non è garantito, e un'impronta che cambia per il solo ordine
 * farebbe ricalcolare tutto a caso.
 *
 * @param {Array<object>} rows annunci attivi
 */
export function listingsStamp(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const righe = list.map(structuralLine).sort();
  return {
    count: list.length,
    digest: createHash("sha1").update(righe.join("\n")).digest("hex").slice(0, 12),
  };
}

/**
 * Si può saltare il ricalcolo?
 *
 * Solo se l'impronta è identica E il giro di manutenzione appena fatto non
 * ha cambiato niente: `expire_old_chain_proposals` può aver appena liberato
 * dei proprietari, e quella liberazione non è ancora visibile
 * nell'impronta letta un istante prima.
 *
 * Senza impronta precedente (primo giro dopo un riavvio) non si salta mai:
 * meglio un ricalcolo in più che catene ferme perché il server è ripartito.
 *
 * @param {string|null} previous impronta dell'ultimo giro completato
 * @param {string} current impronta di adesso
 * @param {number} expiredCount catene scadute in questo stesso giro
 */
export function canSkipRecompute(previous, current, expiredCount = 0) {
  if (!previous) return false;
  if (Number(expiredCount) > 0) return false;
  return previous === current;
}
