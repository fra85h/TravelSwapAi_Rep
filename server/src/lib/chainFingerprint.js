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
// Per ciascuno bastano due numeri: QUANTI sono e QUAL È la modifica più
// recente. Se qualcosa nasce, cambia o sparisce, almeno uno dei due si
// muove. Non serve rileggere le righe: sono due query di aggregazione.

/**
 * Impronta stabile da conteggi e date. Volutamente una stringa e non un
 * hash: quando si indaga sui log, "333|2026-08-05T20:11:00Z|2|..." dice
 * subito cosa è cambiato, mentre un digest non dice niente.
 *
 * @param {{count:number, lastChangeAt:string|null}} listings
 * @param {{count:number, lastChangeAt:string|null}} chains
 */
export function chainFingerprint(listings, chains) {
  const part = (x) => `${Number(x?.count ?? 0)}|${x?.lastChangeAt ?? "-"}`;
  return `${part(listings)}~${part(chains)}`;
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
