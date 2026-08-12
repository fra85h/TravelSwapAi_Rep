// Che cosa dire a chi sta scrivendo il prezzo.
//
// Non una probabilità: quella la inventeremmo, perché non abbiamo ancora
// nessuna transazione conclusa da cui ricavarla, e chi legge abbasserebbe il
// prezzo per davvero sulla base di un numero uscito dal nulla. È la stessa
// regola che sta scritta in lib/fareRules.js: tacere è più onesto che
// indovinare su un dato da cui dipendono i soldi di qualcuno.
//
// Qui ci sono solo fatti contati: quanti annunci confrontabili esistono,
// quanti costano meno del tuo, quante persone seguono questa tratta.
// Verificabili, spiegabili, e nessuno di loro finge di sapere il futuro.
//
// La decisione su COSA mostrare vive qui, pura e testabile; il testo sta
// nella schermata. Stessa divisione di lib/publishReview.mjs.

export const MERCATO = {
  SIMILI: "simili",           // ci sono altri annunci come il tuo
  PIU_ECONOMICI: "piuEconomici", // e alcuni costano meno
  IN_ATTESA: "inAttesa",      // qualcuno segue questa tratta
};

/** Numero utilizzabile, oppure null. Number(null) fa 0, e uno zero finto
 *  qui direbbe "nessuno ti segue" quando la verità è "non lo sappiamo". */
function numero(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} ctx
 * @param {Array<{price:number}>} [ctx.comparabili] annunci attivi simili (mai i tuoi)
 * @param {number|string} [ctx.prezzo]  quello che l'utente sta scrivendo
 * @param {number} [ctx.inAttesa]  avvisi di ricerca attivi di ALTRI su questa tratta
 * @returns {Array<{code:string, params:object}>} vuoto = non c'è niente da dire
 */
export function marketContextItems(ctx = {}) {
  const items = [];
  const comparabili = Array.isArray(ctx.comparabili) ? ctx.comparabili : [];
  const prezzo = numero(ctx.prezzo);
  const inAttesa = numero(ctx.inAttesa);

  if (comparabili.length > 0) {
    items.push({ code: MERCATO.SIMILI, params: { n: comparabili.length } });

    // "Quanti costano meno del tuo" ha senso solo con un prezzo scritto, e
    // solo se qualcuno costa davvero meno: dire "0 costano meno" è rumore.
    if (prezzo != null && prezzo > 0) {
      const menoCari = comparabili.filter((c) => {
        const p = numero(c?.price);
        return p != null && p < prezzo;
      }).length;
      if (menoCari > 0) items.push({ code: MERCATO.PIU_ECONOMICI, params: { n: menoCari } });
    }
  }

  // Sta in fondo di proposito: è la voce che dà speranza, e chiudere con
  // "però qualcuno lo sta aspettando" è diverso da aprirci.
  if (inAttesa != null && inAttesa > 0) {
    items.push({ code: MERCATO.IN_ATTESA, params: { n: inAttesa } });
  }

  return items;
}

/**
 * Due annunci sono confrontabili se una persona che cerca il tuo troverebbe
 * anche l'altro: stesso tipo, stessa direzione, stessa tratta o località, e
 * una data abbastanza vicina.
 *
 * Il filtro sulla data si fa qui e non nella query perché i confrontabili si
 * leggono UNA volta sola: l'insieme non dipende dal prezzo, solo il "quanti
 * costano meno" dipende — e quello si ricalcola in locale mentre si digita,
 * senza una richiesta per tasto.
 */
export const GIORNI_VICINI = 3;

export function filtraComparabili(righe, { tipo, dataEvento, escludiId = null, giorni = GIORNI_VICINI } = {}) {
  const base = Array.isArray(righe) ? righe : [];
  const centro = dataEvento ? new Date(dataEvento).getTime() : null;
  const finestra = giorni * 24 * 60 * 60 * 1000;

  return base.filter((r) => {
    if (!r) return false;
    if (escludiId && String(r.id) === String(escludiId)) return false;
    if (tipo && r.type && r.type !== tipo) return false;
    if (centro == null || !Number.isFinite(centro)) return true;

    const suo = r.depart_at || r.check_in || null;
    if (!suo) return false;
    const t = new Date(suo).getTime();
    if (!Number.isFinite(t)) return false;
    return Math.abs(t - centro) <= finestra;
  });
}
