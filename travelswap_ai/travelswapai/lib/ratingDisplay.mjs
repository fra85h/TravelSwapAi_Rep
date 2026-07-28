// lib/ratingDisplay.mjs — regole di visualizzazione delle valutazioni.
//
// Pure e condivise (stesso schema di listingQuestions.mjs): il client le usa
// per disegnare, la CI del server le testa senza bundler. Qui NON c'è la
// logica double-blind — quella vive in SQL (get_user_rating conta solo i voti
// rivelati), così nessun client può aggirarla leggendo i dati grezzi.

// Sotto questa soglia la media non si mostra: "5,0 su un voto" è rumore
// spacciato per reputazione. Si mostra "Nuovo" finché i voti rivelati non
// bastano a dire qualcosa.
export const MIN_RATINGS_FOR_AVERAGE = 3;

/**
 * Come presentare la reputazione di un utente.
 * @param {number|null|undefined} avg  media dei voti rivelati (1..5)
 * @param {number|null|undefined} count  numero di voti rivelati
 * @returns {{show:boolean, isNew:boolean, value:number|null, count:number}}
 *   show=false  -> non mostrare proprio niente (dati non validi)
 *   isNew=true  -> mostrare "Nuovo" senza media
 *   altrimenti  -> value è la media arrotondata a UN decimale, count i voti
 */
export function formatRating(avg, count) {
  // null/undefined vanno esclusi PRIMA della conversione: Number(null) è 0,
  // non NaN, quindi un dato assente sarebbe passato per "zero voti" e avrebbe
  // mostrato "Nuovo" su un utente di cui non sappiamo niente (per esempio
  // quando la lettura fallisce). Assente e zero sono due cose diverse.
  if (count == null) return { show: false, isNew: false, value: null, count: 0 };
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return { show: false, isNew: false, value: null, count: 0 };
  if (n < MIN_RATINGS_FOR_AVERAGE) return { show: true, isNew: true, value: null, count: n };

  // Stessa trappola sulla media: con avg null e voti presenti, Number(null)
  // avrebbe prodotto 0 e poi un "1,0" inventato dal clamp.
  if (avg == null) return { show: true, isNew: true, value: null, count: n };
  const v = Number(avg);
  if (!Number.isFinite(v)) return { show: true, isNew: true, value: null, count: n };
  // dentro i limiti anche se il dato a monte fosse sporco
  const clamped = Math.min(5, Math.max(1, v));
  return { show: true, isNew: false, value: Math.round(clamped * 10) / 10, count: n };
}

/** Quante stelle piene/mezze disegnare per una media (es. 4,3 -> 4 piene + mezza no). */
export function starsFor(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return { full: 0, half: false };
  const rounded = Math.round(Math.min(5, Math.max(0, v)) * 2) / 2; // al mezzo
  return { full: Math.floor(rounded), half: rounded % 1 !== 0 };
}
