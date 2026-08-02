// lib/withTimeout.js — mette un limite di tempo a una promessa.
//
// Nato da un caso concreto: il salvataggio della nuova password restava
// appeso a `supabase.auth.updateUser()` e la rotellina girava all'infinito.
// Una chiamata di rete che non torna è sempre possibile — connessione persa
// a metà, scheda del browser sospesa, server che non risponde — e senza un
// limite l'utente resta davanti a una schermata che non dice niente e non
// permette nemmeno di riprovare.
//
// L'etichetta finisce nel messaggio d'errore di proposito: sapere QUALE
// passaggio non è tornato è la differenza fra un bug diagnosticabile e uno
// no, e qui i passaggi sono due (cambio password e uscita) con conseguenze
// molto diverse.
export const TIMEOUT_PREFIX = "timeout:";

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${TIMEOUT_PREFIX}${label}`)), ms);
  });
  // finally e non then: il timer va spento anche quando la promessa
  // rifiuta, altrimenti resta acceso fino allo scadere.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
