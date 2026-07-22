// lib/trainStations.js — elenco curato delle principali stazioni italiane,
// per l'autocompletamento della tratta in creazione annuncio e avvisi di
// ricerca. Formato "Città — Stazione" quando la città ha più stazioni note
// (o un nome di stazione utile da distinguere), altrimenti solo "Città".
// Nessuna colonna DB nuova: resta un suggerimento su un campo di testo
// libero, che l'utente può comunque digitare a mano.
export const STATIONS = [
  "Milano — Centrale", "Milano — Garibaldi", "Milano — Porta Genova", "Milano — Rogoredo", "Milano — Lambrate",
  "Roma — Termini", "Roma — Tiburtina", "Roma — Ostiense",
  "Torino — Porta Nuova", "Torino — Porta Susa",
  "Napoli — Centrale", "Napoli — Afragola", "Napoli — Campi Flegrei",
  "Firenze — Santa Maria Novella", "Firenze — Campo di Marte", "Firenze — Rifredi",
  "Bologna — Centrale",
  "Venezia — Santa Lucia", "Venezia — Mestre",
  "Genova — Piazza Principe", "Genova — Brignole",
  "Verona — Porta Nuova",
  "Bari — Centrale",
  "Palermo — Centrale",
  "Catania — Centrale",
  "Messina — Centrale",
  "Reggio Emilia — AV Mediopadana", "Reggio Emilia — Centrale",
  "Reggio Calabria — Centrale",
  "Padova", "Bergamo", "Brescia", "Bolzano", "Trento",
  "Trieste — Centrale", "Udine",
  "Perugia", "Ancona",
  "Pescara — Centrale",
  "Lecce", "Taranto", "Foggia",
  "Cagliari", "Sassari", "Olbia",
  "Salerno", "Caserta", "Latina",
  "La Spezia — Centrale",
  "Piacenza", "Parma", "Modena", "Rimini",
  "Pisa — Centrale", "Livorno — Centrale", "Siena", "Arezzo",
  "Cosenza", "Novara", "Alessandria",
  "Vicenza", "Treviso", "Ferrara", "Ravenna", "Forlì", "Cesena",
  "L'Aquila", "Chieti", "Campobasso", "Potenza", "Matera",
];

function stripAccents(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Suggerimenti che contengono la query (accenti/maiuscole ignorati). */
export function searchStations(query, limit = 6) {
  const q = stripAccents(query).trim();
  if (!q) return [];
  return STATIONS.filter((s) => stripAccents(s).includes(q)).slice(0, limit);
}

/** Estrae la sola città da "Città — Stazione" (o l'intera stringa se non c'è la stazione). */
export function cityOf(label) {
  const s = String(label || "");
  const idx = s.indexOf(" — ");
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}
