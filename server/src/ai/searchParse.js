// server/src/ai/searchParse.js — ricerca in linguaggio naturale.
//
// Traduce una frase ("treno Roma-Milano venerdì mattina sotto 40€") in
// FILTRI STRUTTURATI, che il client applica poi con una normale query sui
// dati già caricati. Volutamente NON è una ricerca semantica su embedding:
// con un catalogo di questa taglia un filtro deterministico è più veloce,
// più prevedibile e spiegabile all'utente (i chip "cosa ho capito").
//
// L'AI qui fa una cosa sola: capire la frase. Il filtraggio resta
// deterministico, quindi se l'AI non risponde la ricerca non si rompe —
// il client ricade sulla ricerca testuale semplice che aveva già.
import { createOpenAIClient } from "../lib/openaiClient.js";
import { reportFault } from "../lib/monitoring.js";

const MODEL = process.env.MATCH_AI_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.MATCH_AI_TEMP ?? 0);

// Una query di ricerca è corta: qui il tempo che conta è la percezione
// dell'utente davanti alla barra, non la completezza. Timeout stretto.
const client = createOpenAIClient({ timeoutMs: Number(process.env.OPENAI_SEARCH_TIMEOUT_MS || 15_000) });

// Tetto sui caratteri: una ricerca vera sta in una riga. Oltre è incolla
// accidentale, e non ha senso pagarne il parsing.
const MAX_QUERY_CHARS = 300;

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const SYSTEM_PROMPT = `
Sei un traduttore di ricerche per un marketplace di biglietti treno e prenotazioni hotel.
Ricevi una frase in linguaggio naturale e restituisci SOLO un JSON di filtri conforme allo schema.
Regole:

1) "type": "train" se cerca un treno, "hotel" se cerca un albergo/soggiorno; null se non è chiaro.

2) Tratta (solo treni)
- "origin"/"destination": città o stazione di partenza e arrivo, come le scrive l'utente (mantieni accenti e nomi propri).
- Espressioni come "da X a Y", "X-Y", "X → Y", "per Y" (solo destinazione) vanno interpretate.
- Se cita una sola città senza dire se è partenza o arrivo, mettila in "destination".

3) Località (solo hotel)
- "location": la città/zona del soggiorno. Per gli hotel lascia sempre origin/destination a null.

4) Date — "oggi" ti viene passato nel messaggio utente come YYYY-MM-DD
- "dateFrom"/"dateTo" in "YYYY-MM-DD", sempre nel FUTURO rispetto a oggi.
- Un giorno singolo ("venerdì", "8 agosto") → dateFrom = dateTo = quel giorno.
- Un intervallo ("questo weekend", "la prossima settimana", "dal 3 al 7") → estremi corrispondenti.
- "domani", "dopodomani" → il giorno relativo a oggi.
- Un nome di giorno senza altro ("venerdì") = il PRIMO venerdì che viene dopo oggi.
- Nessun riferimento temporale → entrambi null. Non inventare mai date.

5) Prezzo
- "maxPrice": numero, se dice "sotto/max/entro/fino a N€" o "economico" con una cifra.
- "minPrice": numero, solo se dice esplicitamente "almeno/da N€ in su".
- Nessuna cifra → null. "economico" senza numero NON è un prezzo: lascia null.

6) Cosa NON fare
- Non inventare filtri non presenti nella frase: nel dubbio, null.
- Ignora fasce orarie ("mattina", "sera"): non sono filtrabili, non metterle nelle date.
- Nessuna chiave fuori dallo schema.
`;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: ["string", "null"], enum: ["train", "hotel", null] },
    origin: { type: ["string", "null"] },
    destination: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    dateFrom: { type: ["string", "null"], description: "YYYY-MM-DD" },
    dateTo: { type: ["string", "null"], description: "YYYY-MM-DD" },
    maxPrice: { type: ["number", "null"] },
    minPrice: { type: ["number", "null"] },
  },
  required: ["type", "origin", "destination", "location", "dateFrom", "dateTo", "maxPrice", "minPrice"],
};

const EMPTY_FILTERS = {
  type: null,
  origin: null,
  destination: null,
  location: null,
  dateFrom: null,
  dateTo: null,
  maxPrice: null,
  minPrice: null,
};

function normStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normDate(v) {
  const s = normStr(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Ripulisce l'output del modello: nessun filtro fuori forma arriva al client. */
export function sanitizeFilters(raw) {
  const f = { ...EMPTY_FILTERS, ...(raw || {}) };
  const out = {
    type: f.type === "train" || f.type === "hotel" ? f.type : null,
    origin: normStr(f.origin),
    destination: normStr(f.destination),
    location: normStr(f.location),
    dateFrom: normDate(f.dateFrom),
    dateTo: normDate(f.dateTo),
    maxPrice: normNum(f.maxPrice),
    minPrice: normNum(f.minPrice),
  };

  // Un intervallo al contrario non filtrerebbe nulla: lo si raddrizza invece
  // di restituire zero risultati per un refuso del modello.
  if (out.dateFrom && out.dateTo && out.dateFrom > out.dateTo) {
    [out.dateFrom, out.dateTo] = [out.dateTo, out.dateFrom];
  }
  if (out.minPrice != null && out.maxPrice != null && out.minPrice > out.maxPrice) {
    [out.minPrice, out.maxPrice] = [out.maxPrice, out.minPrice];
  }

  // Coerenza col tipo: una tratta su un hotel (o una località su un treno)
  // sono contraddizioni che filtrerebbero via tutto.
  if (out.type === "hotel") {
    out.origin = null;
    out.destination = null;
  }

  return out;
}

export async function parseSearchQueryWithAI(query, locale = "it") {
  if (!client) {
    const err = new Error("Servizio AI non configurato sul server (OPENAI_API_KEY mancante).");
    err.status = 503;
    throw err;
  }

  const q = String(query ?? "").trim().slice(0, MAX_QUERY_CHARS);
  if (!q) return { ...EMPTY_FILTERS };

  const resp = await client.responses.create({
    model: MODEL,
    temperature: TEMPERATURE,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Oggi è: ${today()}\n` +
          `Lingua: ${locale}\n` +
          `Ricerca: """${q}"""\n` +
          `Rispondi SOLO con JSON conforme allo schema.`,
      },
    ],
    text: {
      format: { type: "json_schema", name: "SearchFilters", strict: true, schema: JSON_SCHEMA },
    },
  });

  const out =
    resp?.output_text ||
    resp?.output?.[0]?.content?.[0]?.text ||
    "";

  try {
    return sanitizeFilters(JSON.parse(out || "{}") || {});
  } catch {
    console.warn("[AI] JSON parse ricerca fallita. Raw:", out?.slice?.(0, 200));
    const err = new Error("Il servizio AI ha risposto in un formato non valido.");
    err.status = 502;
    throw err;
  }
}

// Route HTTP. Come /ai/parse-description: un guasto NON viene mascherato con
// una risposta vuota (sarebbe indistinguibile da "non ho capito filtri"), ma
// il client è comunque costruito per degradare da solo alla ricerca testuale.
export function mountParseSearchRoute(app, requireAuth) {
  app.post("/ai/parse-search", requireAuth, async (req, res) => {
    try {
      const { query, locale = "it" } = req.body || {};
      const filters = await parseSearchQueryWithAI(query, locale);
      return res.json({ ok: true, filters });
    } catch (err) {
      reportFault("/ai/parse-search", err);
      const status = err?.status || 502;
      return res.status(status).json({
        ok: false,
        error: err?.message || "Interpretazione della ricerca non riuscita.",
      });
    }
  });
}
