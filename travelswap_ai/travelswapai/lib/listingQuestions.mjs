// lib/listingQuestions.mjs — catalogo delle domande sull'annuncio.
//
// È il contratto condiviso: il server valida contro questo elenco prima di
// registrare una domanda, il client ci costruisce sopra l'interfaccia, e i
// test lo verificano da solo. Un codice che non è qui dentro non esiste.
//
// Perché un elenco CHIUSO e non testo libero: senza campo libero non ci sono
// numeri di telefono da intercettare, non serve moderare niente (che
// costerebbe una chiamata AI per messaggio, sullo stesso budget che oggi dà
// 429 durante i Check AI) e non ci sono falsi positivi su testo innocente —
// in questa app si scrivono di continuo numeri di treno, orari e PNR, che a
// un filtro anti-contatti somigliano parecchio a recapiti.
//
// Le risposte sono PUBBLICHE sull'annuncio, non un messaggio privato: il
// venditore risponde una volta e la legge chiunque, così il volume di domande
// scende invece di crescere. Ed è anche il motivo per cui nessuna domanda qui
// può essere personale — sono tutte proprietà del biglietto.
//
// .mjs come textPatterns/trainStations: importabile sia da Metro sia da Node,
// così la CI del server può testarlo senza un bundler.

/** Chi può rispondere: solo il proprietario dell'annuncio. */
export const ANSWER_UNKNOWN = 'unknown';

/**
 * showWhen riceve l'annuncio e dice se la domanda ha senso per QUELL'annuncio.
 * Serve a non chiedere quello che è già scritto sulla scheda: `operator` è una
 * colonna che l'AI riempie dall'import o dalla descrizione, quindi la domanda
 * compare solo quando è rimasta vuota. Stessa logica per la classe.
 */
export const QUESTION_CATALOG = [
  {
    code: 'operator',
    type: 'train',
    answers: ['trenitalia', 'italo', 'other', ANSWER_UNKNOWN],
    showWhen: (l) => !String(l?.operator || '').trim(),
  },
  {
    code: 'ticket_class',
    type: 'train',
    answers: ['first', 'second', 'business', 'standard', ANSWER_UNKNOWN],
    showWhen: (l) => !String(l?.ticket_class || '').trim(),
  },
  {
    code: 'refundable',
    type: 'train',
    // Rimborso e modifica in una domanda sola: al compratore serve sapere la
    // stessa cosa, cioè cosa gli succede se poi non parte. Chiedere solo
    // "rimborsabile?" lascerebbe fuori il caso più comune, la tariffa
    // modificabile ma non rimborsabile.
    answers: ['both', 'changeable_only', 'neither', ANSWER_UNKNOWN],
    showWhen: () => true,
  },
  {
    code: 'photo',
    type: 'train',
    // Non è una domanda ma una richiesta: le "risposte" sono due azioni.
    answers: ['added', 'declined'],
    showWhen: () => true,
    isRequest: true,
  },
  {
    code: 'name_change_who',
    type: 'train',
    answers: ['seller', 'buyer', 'not_possible', ANSWER_UNKNOWN],
    // Solo dove serve davvero: l'app sa già se il biglietto è nominativo.
    showWhen: (l) => l?.is_named_ticket === true,
  },
  {
    code: 'name_change_cost',
    type: 'train',
    // Separata dalla precedente perché "a carico tuo" si legge sia come CHI lo
    // fa sia come CHI lo paga, e sono due decisioni diverse: un venditore può
    // occuparsene volentieri e volere indietro la commissione.
    answers: ['included', 'buyer_pays', 'no_cost', ANSWER_UNKNOWN],
    showWhen: (l) => l?.is_named_ticket === true,
  },
  {
    code: 'delivery',
    type: 'train',
    answers: ['on_accept', 'day_before', 'agree_in_chat'],
    showWhen: () => true,
  },
];

const BY_CODE = new Map(QUESTION_CATALOG.map((q) => [q.code, q]));

/** La definizione di una domanda, o null se il codice non esiste. */
export function getQuestion(code) {
  return BY_CODE.get(String(code || '')) || null;
}

/** Vero se quella risposta è ammessa per quella domanda. */
export function isValidAnswer(code, answer) {
  const q = getQuestion(code);
  if (!q) return false;
  return q.answers.includes(String(answer || ''));
}

/**
 * Le domande che ha senso porre su questo annuncio, escluse quelle già poste
 * da questa persona (il vincolo di unicità a DB è il backstop, questo è per
 * non mostrarle proprio).
 *
 * @param {object} listing
 * @param {string[]} [alreadyAsked] codici già presenti sull'annuncio
 */
export function questionsForListing(listing, alreadyAsked = []) {
  const tipo = String(listing?.type || '').toLowerCase() === 'hotel' ? 'hotel' : 'train';
  const visti = new Set(alreadyAsked.map(String));
  return QUESTION_CATALOG.filter(
    (q) => q.type === tipo && !visti.has(q.code) && q.showWhen(listing),
  );
}

/**
 * Un annuncio può ricevere una domanda solo se è un VENDO attivo di qualcun
 * altro: su un CERCO non c'è nessun biglietto di cui chiedere le proprietà, e
 * al proprio annuncio non si fanno domande.
 *
 * Funzione pura, senza accesso a rete o DB: la stessa regola vale lato server
 * (dove è vincolante) e lato client (dove serve solo a nascondere il pulsante).
 *
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function canAskAbout(listing, askerId) {
  if (!listing?.id) return { allowed: false, reason: 'listing_not_found' };
  if (String(listing.status || '').toLowerCase() !== 'active') {
    return { allowed: false, reason: 'listing_not_active' };
  }
  if (String(listing.cerco_vendo || '').toUpperCase() !== 'VENDO') {
    return { allowed: false, reason: 'not_a_vendo' };
  }
  if (!askerId) return { allowed: false, reason: 'not_authenticated' };
  if (String(listing.user_id) === String(askerId)) {
    return { allowed: false, reason: 'own_listing' };
  }
  return { allowed: true, reason: null };
}
