// server/src/middleware/withCronLease.js
//
// Un giro di manutenzione alla volta.
//
// Gli endpoint periodici erano protetti solo da un rate limiter, che conta
// le richieste ma non sa niente di quelle ancora in corso: un giro più lento
// del solito e il successivo che parte a orario si sovrappongono senza che
// nulla lo impedisca. Due esecuzioni leggono lo stesso stato, decidono la
// stessa cosa e la scrivono due volte — e nel caso del calo prezzo chi ha
// salvato l'annuncio riceve due notifiche identiche.
//
// Il turno vive nel database (vedi 20260818140000): sopravvive alla singola
// chiamata, vale anche con più istanze del server, e ha una scadenza, così
// un processo morto a metà giro non lascia un cron bloccato per sempre.
//
// Chi non prende il turno risponde 200, non un errore: il giro è saltato di
// proposito perché ce n'è già uno in corso, ed è esattamente ciò che doveva
// succedere. Un 500 farebbe suonare gli allarmi per il funzionamento
// normale, e un 429 direbbe "hai chiamato troppo", che non è il caso.
import { supabase } from "../db.js";

/**
 * @param {string} nome  identificatore del job, uguale a ogni giro
 * @param {object} [opts]
 * @param {number} [opts.ttlSeconds] quanto dura il turno se nessuno lo
 *   restituisce (processo morto, riavvio). Va tenuto più lungo del giro più
 *   lento possibile, o il turno si libererebbe mentre il lavoro è in corso.
 */
export function withCronLease(nome, { ttlSeconds = 600 } = {}) {
  return async function claimCronLease(req, res, next) {
    if (!supabase) return next(); // niente database configurato: se ne occupa l'handler

    let gettone = null;
    try {
      const { data, error } = await supabase.rpc("claim_cron_lease", {
        p_name: nome,
        p_ttl_seconds: ttlSeconds,
      });
      if (error) throw error;
      gettone = data ?? null;
    } catch (e) {
      // Il turno non si è potuto chiedere. Si va avanti lo stesso: saltare
      // ogni giro perché la tabella dei turni non risponde trasformerebbe un
      // guasto piccolo in "la manutenzione non gira più", che è peggio del
      // rischio che questo middleware evita.
      console.error(`[cron-lease:${nome}] turno non verificabile, proseguo:`, e?.message || e);
      return next();
    }

    if (!gettone) {
      console.log(`[cron-lease:${nome}] giro saltato: ce n'è già uno in corso`);
      return res.status(200).json({ skipped: true, reason: "already_running" });
    }

    // Il turno si restituisce quando la risposta è chiusa, comunque sia
    // andata: 'finish' copre la risposta inviata, 'close' il client che
    // stacca a metà. Il flag evita la doppia restituzione quando scattano
    // entrambi.
    let restituito = false;
    const restituisci = async () => {
      if (restituito) return;
      restituito = true;
      try {
        const { error } = await supabase.rpc("release_cron_lease", { p_name: nome, p_holder: gettone });
        if (error) throw error;
      } catch (e) {
        // Non è grave: il turno scade da solo. Vale la pena saperlo, però,
        // perché finché non scade i giri successivi vengono saltati.
        console.error(`[cron-lease:${nome}] turno non restituito (scadrà da solo):`, e?.message || e);
      }
    };
    res.on("finish", restituisci);
    res.on("close", restituisci);

    return next();
  };
}
