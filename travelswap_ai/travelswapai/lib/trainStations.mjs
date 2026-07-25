// lib/trainStations.mjs — elenco curato delle stazioni ferroviarie italiane,
// usato per due cose: l'autocompletamento della tratta (creazione annuncio e
// avvisi di ricerca) e — da lib/textPatterns.mjs — il riconoscimento della
// tratta nel testo incollato.
//
// Formato "Città — Stazione" quando la città ha più stazioni note (o quando
// il nome della stazione va distinto), altrimenti solo "Città". Nessuna
// colonna DB nuova: resta un suggerimento su un campo di testo libero, che
// l'utente può comunque digitare a mano.
//
// COPERTURA: tutti i capoluoghi di provincia più le stazioni secondarie di
// traffico rilevante (nodi, località turistiche, fermate delle direttrici
// principali). NON è l'elenco completo delle stazioni italiane, che ne conta
// alcune migliaia: per quello servirebbe un dataset ufficiale importato, non
// una lista scritta a mano. Le località fuori elenco restano gestite dal
// ripiego a regex in textPatterns.mjs, quindi un'assenza qui abbassa la
// precisione ma non toglie funzionalità.
//
// NOMI AMBIGUI: alcune stazioni si chiamano come parole italiane comuni —
// Ora (Alto Adige), Fermo, Massa, Chiusi, Bra. Inserite "nude" farebbero
// inventare tratte a partire da frasi normali: "biglietto Milano ora 10:30"
// diventerebbe Milano→Ora. Compaiono quindi SOLO nella forma estesa con la
// stazione, che non collide con nulla. Vedi il test
// "nessuna voce dell'elenco collide con parole italiane comuni".
export const STATIONS = [
  // ---- Nodi principali (più stazioni per città) ----
  "Milano — Centrale", "Milano — Garibaldi", "Milano — Porta Genova", "Milano — Rogoredo",
  "Milano — Lambrate", "Milano — Cadorna", "Milano — Greco Pirelli", "Milano — San Cristoforo",
  "Roma — Termini", "Roma — Tiburtina", "Roma — Ostiense", "Roma — Trastevere", "Roma — Tuscolana",
  "Torino — Porta Nuova", "Torino — Porta Susa", "Torino — Lingotto", "Torino — Stura",
  "Napoli — Centrale", "Napoli — Afragola", "Napoli — Campi Flegrei", "Napoli — Mergellina",
  "Firenze — Santa Maria Novella", "Firenze — Campo di Marte", "Firenze — Rifredi",
  "Bologna — Centrale", "Bologna — San Ruffillo",
  "Venezia — Santa Lucia", "Venezia — Mestre",
  "Genova — Piazza Principe", "Genova — Brignole", "Genova — Nervi", "Genova — Sestri Ponente",
  "Verona — Porta Nuova", "Verona — Porta Vescovo",
  "Palermo — Centrale", "Palermo — Notarbartolo",
  "Catania — Centrale", "Catania — Acquicella",
  "Bari — Centrale", "Bari — Torre a Mare",
  "Messina — Centrale", "Messina — Marittima",
  "Reggio Emilia — AV Mediopadana", "Reggio Emilia — Centrale",
  "Reggio Calabria — Centrale", "Reggio Calabria — Lido",
  "Pescara — Centrale", "Pescara — Porta Nuova",
  "La Spezia — Centrale", "La Spezia — Migliarina",
  "Pisa — Centrale", "Pisa — San Rossore",
  "Livorno — Centrale", "Trieste — Centrale",

  // ---- Capoluoghi di provincia ----
  "Aosta",
  "Alessandria", "Asti", "Biella", "Cuneo", "Novara", "Verbania", "Vercelli",
  "Bergamo", "Brescia", "Como", "Cremona", "Lecco", "Lodi", "Mantova", "Monza", "Pavia",
  "Sondrio", "Varese",
  "Bolzano", "Trento",
  "Belluno", "Padova", "Rovigo", "Treviso", "Vicenza",
  "Gorizia", "Pordenone", "Udine",
  "Imperia", "Savona",
  "Ferrara", "Forlì", "Cesena", "Modena", "Parma", "Piacenza", "Ravenna", "Rimini",
  "Arezzo", "Grosseto", "Lucca", "Carrara", "Pistoia", "Prato", "Siena",
  "Massa — Centro",
  "Perugia", "Terni",
  "Ancona", "Ascoli Piceno", "Macerata", "Pesaro", "Urbino",
  "Porto San Giorgio — Fermo",
  "Frosinone", "Latina", "Rieti", "Viterbo",
  "L'Aquila", "Chieti", "Teramo",
  "Campobasso", "Isernia",
  "Salerno", "Caserta", "Benevento", "Avellino",
  "Barletta", "Andria", "Trani", "Brindisi", "Foggia", "Lecce", "Taranto",
  "Potenza", "Matera",
  "Catanzaro", "Cosenza", "Crotone", "Vibo Valentia",
  "Agrigento", "Caltanissetta", "Enna", "Ragusa", "Siracusa", "Trapani",
  "Cagliari", "Nuoro", "Oristano", "Sassari",

  // ---- Nodi e fermate rilevanti sulle direttrici ----
  // Nord-ovest
  "Rho — Fiera", "Gallarate", "Busto Arsizio", "Saronno", "Seregno", "Desio",
  "Treviglio", "Chiari", "Rovato", "Voghera", "Stradella", "Tortona", "Arquata Scrivia",
  "Domodossola", "Arona", "Stresa", "Ivrea", "Chivasso", "Santhià", "Casale Monferrato",
  "Acqui Terme", "Ovada", "Mondovì", "Fossano", "Savigliano", "Bra — Cuneo",
  // Liguria
  "Ventimiglia", "Sanremo", "Taggia", "Alassio", "Albenga", "Finale Ligure", "Loano",
  "Pietra Ligure", "Varazze", "Arenzano", "Chiavari", "Rapallo", "Santa Margherita Ligure",
  "Sestri Levante", "Levanto", "Monterosso", "Riomaggiore", "Manarola", "Vernazza",
  // Triveneto
  "Rovereto", "Bressanone", "Brunico", "Merano", "Fortezza", "Ora — Termeno",
  "Peschiera del Garda", "Desenzano del Garda", "Bassano del Grappa",
  "Castelfranco Veneto", "Conegliano", "Vittorio Veneto", "Portogruaro", "San Donà di Piave",
  "Chioggia", "Monfalcone", "Cervignano", "Latisana", "Tarvisio",
  // Emilia-Romagna
  "Imola", "Faenza", "Castel Bolognese", "Lugo", "Cattolica", "Riccione", "Misano Adriatico",
  "Cesenatico", "Cervia", "Fidenza", "Salsomaggiore Terme", "Fiorenzuola", "Carpi", "Sassuolo",
  // Toscana / Umbria / Marche
  "Empoli", "Poggibonsi", "Montecatini Terme", "Viareggio", "Pietrasanta", "Camaiore",
  "Follonica", "Piombino", "Orbetello", "Chiusi — Chianciano Terme", "Cortona", "Foligno",
  "Spoleto", "Assisi", "Città di Castello", "Falconara Marittima", "Senigallia", "Fano",
  "Civitanova Marche", "San Benedetto del Tronto", "Grottammare", "Loreto", "Jesi", "Fabriano",
  // Lazio / Abruzzo / Molise
  "Civitavecchia", "Ladispoli", "Orte", "Fiumicino Aeroporto", "Ciampino", "Albano Laziale",
  "Velletri", "Cassino", "Formia", "Fondi", "Terracina", "Anzio", "Nettuno",
  "Sulmona", "Avezzano", "Giulianova", "Roseto degli Abruzzi", "Vasto", "Termoli",
  // Campania / Puglia / Basilicata
  "Aversa", "Nocera Inferiore", "Cava de' Tirreni", "Battipaglia", "Agropoli", "Sapri",
  "Vallo della Lucania", "Torre del Greco", "Castellammare di Stabia", "Sorrento", "Pompei",
  "Ercolano", "Nola", "Sarno",
  "Molfetta", "Bisceglie", "Bitonto", "Monopoli", "Fasano", "Ostuni", "Carovigno",
  "Gioia del Colle", "Altamura", "Gravina in Puglia", "Cerignola", "San Severo", "Lucera",
  "Manfredonia", "Nardò", "Gallipoli", "Maglie", "Otranto", "Casarano", "Manduria", "Massafra",
  "Metaponto", "Policoro", "Melfi", "Lauria",
  // Calabria / Sicilia / Sardegna
  "Lamezia Terme — Centrale", "Paola", "Amantea", "Scalea", "Praia a Mare", "Diamante",
  "Tropea", "Vibo Marina", "Rosarno", "Villa San Giovanni", "Soverato", "Locri", "Siderno",
  "Sibari", "Corigliano", "Rossano",
  "Cefalù", "Termini Imerese", "Milazzo", "Barcellona Pozzo di Gotto", "Taormina — Giardini",
  "Acireale", "Giarre — Riposto", "Gela", "Licata", "Marsala", "Mazara del Vallo",
  "Castelvetrano", "Alcamo", "Partinico", "Bagheria", "Modica", "Noto", "Avola", "Augusta",
  "Lentini",
  "Olbia", "Golfo Aranci", "Porto Torres", "Macomer", "Carbonia", "Iglesias", "Decimomannu",
];

// Nomi di stazione che coincidono con parole italiane di uso corrente. Sono
// presenti in STATIONS solo nella forma estesa ("Ora — Termeno"), ma chi
// deriva le città con cityOf() li otterrebbe comunque nudi: usare questo
// insieme per escluderli, altrimenti "biglietto Milano ora 10:30" diventa la
// tratta Milano→Ora. Le stazioni restano cercabili per nome esteso.
export const AMBIGUOUS_BARE_NAMES = new Set([
  "ora", "fermo", "massa", "chiusi", "bra",
]);

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
