// Il corridoio di chi usa l'app: da dove viene, dove studia.
//
// Uno studente fuorisede non ha "una località preferita": ha DUE città e le
// fa avanti e indietro. Chiederle così — invece di un campo libero
// "tratta preferita" — cambia tre cose in un colpo: la domanda è più facile
// (sono due nomi di città, non una sintassi), la risposta è più precisa, e
// da due città si ricava tutto il resto senza chiedere altro.
//
// Il pezzo che rende questo utile è che la macchina esiste già:
// HomeScreen confronta le località preferite (prefs.locations) con
// location/route_from/route_to di ogni annuncio, per contenimento di
// stringa. Quindi le due città vanno salvate SEPARATE, non unite in
// "Milano → Napoli": "milano" è contenuto in "roma → milano", mentre
// "milano napoli" non è contenuto in niente. Salvarle unite sarebbe il modo
// silenzioso di non far funzionare niente.
//
// Le due città coprono da sole entrambi i versi del viaggio, che è
// esattamente quello che serve a chi torna a casa il venerdì e riparte la
// domenica.

/** Normalizza un nome di città come lo scriverebbe una persona. */
const pulisci = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

/**
 * Le città che l'utente ha dichiarato, lette da prefs — comprese quelle
 * salvate col vecchio campo libero, che poteva contenere "Milano → Napoli",
 * "Milano, Napoli" o una città sola.
 *
 * @returns {{casa: string, studio: string}} stringhe vuote se non si sa
 */
export function cittaDaPrefs(prefs) {
  const casaEsplicita = pulisci(prefs?.homeCity);
  const studioEsplicito = pulisci(prefs?.studyCity);
  if (casaEsplicita || studioEsplicito) {
    return { casa: casaEsplicita, studio: studioEsplicito };
  }

  // Nessun campo nuovo: si recupera dal vecchio, senza perdere niente di
  // quello che l'utente aveva già scritto.
  const grezzo = Array.isArray(prefs?.locations) && prefs.locations.length
    ? prefs.locations
    : [prefs?.location];

  const pezzi = grezzo
    .flatMap((s) => String(s ?? "").split(/-->|→|,/))
    .map(pulisci)
    .filter(Boolean);

  return { casa: pezzi[0] || "", studio: pezzi[1] || "" };
}

/**
 * Le preferenze da salvare, a partire dalle due città.
 *
 * `locations` resta l'array che HomeScreen legge già: ci finiscono le due
 * città separate. `location` resta la prima, per chi legge ancora il vecchio
 * campo singolo. Nessuno dei due sparisce: aggiungere un campo non deve
 * rompere chi leggeva quelli di prima.
 */
export function prefsConCorridoio(base, { casa, studio } = {}) {
  const c = pulisci(casa);
  const s = pulisci(studio);
  // Due volte la stessa città non è un corridoio: si tiene una volta sola,
  // altrimenti l'ordinamento della vetrina la peserebbe il doppio.
  const citta = [c, s].filter(Boolean).filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);

  return {
    ...base,
    homeCity: c || undefined,
    studyCity: s || undefined,
    location: citta[0] || undefined,
    locations: citta.length ? citta : undefined,
  };
}

/**
 * Il corridoio da nominare nei testi, o null se non lo sappiamo.
 * Serve a scrivere "Non c'è ancora niente su Milano ↔ Napoli" invece di
 * "Ancora nessun annuncio in giro", che non parla a nessuno.
 */
export function corridoio(prefs) {
  const { casa, studio } = cittaDaPrefs(prefs);
  if (!casa || !studio) return null;
  return { casa, studio, etichetta: `${casa} ↔ ${studio}` };
}
