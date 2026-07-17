// server/src/ai/chainMatch.js
// Normalizzazione "fuzzy" per lo swap a catena: dato un annuncio CERCO
// (cosa un utente vuole) e un lotto di annunci VENDO candidati di altri
// utenti, stima quanto bene ciascun candidato soddisfa la richiesta,
// tollerando città vicine e date non identiche — esattamente i due
// parametri validati nella simulazione di mercato (±3 giorni, stessa
// area geografica) che facevano la differenza tra ~0% e ~92% di
// copertura.
//
// Stesso pattern del matcher esistente (ai/score.js): AI primaria con
// fallback euristico deterministico se la chiave manca o la chiamata
// fallisce, così la ricerca cicli non si blocca mai per un problema
// di rete/quota OpenAI.
import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const MODEL = process.env.CHAIN_AI_MODEL || process.env.MATCH_AI_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.CHAIN_AI_TEMP ?? 0);
const MAX_CANDIDATES_PER_CALL = Number(process.env.CHAIN_AI_BATCH ?? 40);
const CHAIN_AI_TIMEOUT_MS = Number(process.env.CHAIN_AI_TIMEOUT_MS ?? 15000);
const CHAIN_SCORE_THRESHOLD = Number(process.env.CHAIN_SCORE_THRESHOLD ?? 65);

// ----------------------------------------------------------------------
// Fallback deterministico: cluster geografico + tolleranza data.
// ----------------------------------------------------------------------

// Regioni approssimate: sufficiente per giudicare "abbastanza vicino da
// valere uno scambio", non un dato geografico preciso.
const REGION_BY_CITY = {
  roma: "centro", firenze: "centro", bologna: "centro", perugia: "centro", pisa: "centro",
  milano: "nord", torino: "nord", venezia: "nord", verona: "nord", genova: "nord",
  trieste: "nord", bergamo: "nord", brescia: "nord", padova: "nord",
  napoli: "sud", bari: "sud", palermo: "sud", catania: "sud", cagliari: "sud",
  salerno: "sud", messina: "sud",
};

function normCityKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // rimuove accenti
    .trim();
}

function regionOf(cityRaw) {
  const key = normCityKey(cityRaw);
  if (!key) return null;
  if (REGION_BY_CITY[key]) return REGION_BY_CITY[key];
  // match su singola parola (es. "Roma Termini" -> "roma"), non su
  // sottostringa libera: una sottostringa libera farebbe scambiare per
  // "centro" una città come "Romano di Lombardia" (nord) solo perché
  // contiene la sequenza "roma".
  for (const word of key.split(/\s+/)) {
    if (REGION_BY_CITY[word]) return REGION_BY_CITY[word];
  }
  return null;
}

// route_from/route_to sono le colonne strutturate; `location` a volte
// contiene "CittaA-->CittaB" come stringa legacy (vedi CreateListingScreen).
function parseArrowLocation(location) {
  const s = String(location || "");
  const m = s.split(/-->|→/).map((x) => x.trim()).filter(Boolean);
  if (m.length >= 2) return { from: m[0], to: m[1] };
  if (m.length === 1) return { from: m[0], to: null };
  return { from: null, to: null };
}

function routeOf(listing) {
  if (listing?.type === "hotel") {
    const city = listing.location || null;
    return { from: city, to: city };
  }
  const from = listing?.route_from || parseArrowLocation(listing?.location).from;
  const to = listing?.route_to || parseArrowLocation(listing?.location).to;
  return { from, to };
}

function dateOf(listing) {
  const raw = listing?.type === "hotel" ? listing?.check_in : listing?.depart_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function withinDateTolerance(a, b, days) {
  const da = dateOf(a);
  const db = dateOf(b);
  if (!da || !db) return false;
  const diffDays = Math.abs(da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

// Due livelli di vicinanza geografica, non uno solo: "stessa area" (regione
// larga, es. tutto il sud Italia) da sola NON deve bastare a superare la
// soglia se le date sono lontane — altrimenti "Napoli→Bari il 3 agosto" e
// "Palermo→Catania il 1 settembre" risulterebbero compatibili solo perché
// entrambe le coppie di città sono genericamente "sud", con quasi un mese
// di scarto. "Stessa città esatta" (stringa identica) è un segnale molto
// più forte e vale anche con una data più lontana.
function sameRegionRoute(want, candidate) {
  const w = routeOf(want);
  const c = routeOf(candidate);
  const rFrom = regionOf(w.from);
  const rTo = regionOf(w.to);
  if (!rFrom || !rTo) return false;
  return rFrom === regionOf(c.from) && rTo === regionOf(c.to);
}

function exactRouteMatch(want, candidate) {
  const w = routeOf(want);
  const c = routeOf(candidate);
  const wFrom = normCityKey(w.from);
  const wTo = normCityKey(w.to);
  if (!wFrom || !wTo) return false;
  return wFrom === normCityKey(c.from) && wTo === normCityKey(c.to);
}

/**
 * Fallback deterministico, sempre disponibile (nessuna chiamata esterna).
 * Score: 20 base, +15 se le date sono vicine (±3gg), +40 se stessa area
 * geografica larga, +25 in più se le città sono esattamente le stesse
 * (l'esatto implica sempre anche l'area). La soglia CHAIN_SCORE_THRESHOLD
 * (65) passa solo se c'è vicinanza geografica ABBINATA a data vicina o a
 * corrispondenza esatta della città — l'area larga da sola, con date
 * lontane, resta sotto soglia.
 */
export function heuristicChainScore(wantListing, candidates, { dateToleranceDays = 3 } = {}) {
  return (candidates || [])
    .filter(Boolean)
    .map((c) => {
      if (!wantListing || c.type !== wantListing.type) {
        return { id: c.id, score: 0, reason: "tipo diverso" };
      }
      const dateOk = withinDateTolerance(wantListing, c, dateToleranceDays);
      const exactOk = exactRouteMatch(wantListing, c);
      // L'esatto implica sempre anche l'area, anche quando la città non è
      // nella mappa statica REGION_BY_CITY (altrimenti regionOf() torna null
      // e una città identica ma non mappata perderebbe il bonus "stessa area",
      // restando sotto soglia anche con data vicina).
      const regionOk = exactOk || sameRegionRoute(wantListing, c);
      const score = 20 + (dateOk ? 15 : 0) + (regionOk ? 40 : 0) + (exactOk ? 25 : 0);
      return {
        id: c.id,
        score: Math.min(100, score),
        reason: `${exactOk ? "stessa città" : regionOk ? "stessa area" : "area diversa"}, ${dateOk ? "date vicine" : "date distanti"}`,
        model: "heuristic",
      };
    })
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
}

// ----------------------------------------------------------------------
// AI: normalizzazione semantica (città/date) via LLM.
// Non richiede la tabella di regioni statica: giudica caso per caso se
// due città sono "abbastanza vicine" per uno scambio, gestendo anche
// varianti testuali (es. "Roma Termini" vs "Roma Tiburtina") e città
// fuori dalla mappa statica del fallback.
// ----------------------------------------------------------------------

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function slimListing(l) {
  const r = routeOf(l);
  return {
    id: l.id,
    type: l.type,
    from: truncate(r.from, 60),
    to: truncate(r.to, 60),
    date: dateOf(l)?.toISOString() ?? null,
    price: l.price ?? null,
  };
}

function buildChainPrompt(wantListing, candidatesBatch) {
  const want = slimListing(wantListing);
  const candidates = candidatesBatch.map(slimListing);
  return `Sei un motore di normalizzazione fuzzy per uno scambio di biglietti/prenotazioni di viaggio.
Un utente CERCA questo: ${JSON.stringify(want)}

Per ciascun annuncio candidato, stima uno score 0-100 di quanto bene soddisferebbe questa richiesta SE scambiato, tollerando:
- città vicine/equivalenti per uno spostamento (stessa area metropolitana, stazioni diverse della stessa città, città limitrofe ben collegate) anche se il nome non è identico;
- differenze di data fino a circa 3 giorni;
- non tollerare tipo diverso (treno vs hotel) o città in aree completamente diverse d'Italia.

IMPORTANTE: una vicinanza geografica solo generica (es. "entrambe nel sud Italia" ma città diverse e lontane tra loro, tipo Napoli e Palermo) NON basta da sola a dare uno score alto se la data è lontana — richiede o (a) la stessa città/area metropolitana ristretta, oppure (b) area compatibile E data vicina insieme.

Linee guida punteggio: 20=nessuna corrispondenza, 35-45=solo uno dei due criteri (area larga sola, o data vicina sola) — sotto soglia, 65+=area larga E data vicina insieme, 75+=stessa città esatta anche con data più lontana, 90+=stessa città e data entrambe vicine.

Rispondi SOLO con:
{"scores": [{"id": "<uuid>", "score": <int 0-100>, "reason": "<max 100 char, in italiano>"}]}
Un elemento per OGNI candidato, nessuna omissione.

Candidati: ${JSON.stringify(candidates)}`;
}

async function callOpenAIChainScore(prompt, timeoutMs) {
  if (!client) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
  try {
    const resp = await client.responses.create(
      {
        model: MODEL,
        input: prompt,
        temperature: TEMPERATURE,
        text: {
          format: {
            type: "json_schema",
            name: "chain_scores_payload",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["scores"],
              properties: {
                scores: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "score", "reason"],
                    properties: {
                      id: { type: "string" },
                      score: { type: "integer", minimum: 0, maximum: 100 },
                      reason: { type: "string", maxLength: 120 },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { signal: ctrl.signal }
    );
    clearTimeout(timer);

    let text = "";
    if (typeof resp?.output_text === "string") text = resp.output_text;
    else if (Array.isArray(resp?.output)) {
      const c = resp.output[0]?.content?.[0];
      if (c?.type === "output_text") text = c.text || "";
    }
    if (!text.trim()) return null;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return Array.isArray(parsed?.scores) ? parsed.scores : null;
  } catch (e) {
    clearTimeout(timer);
    console.error("[chainMatch] OpenAI error:", e?.status, e?.message || e);
    return null;
  }
}

function validateChainScores(raw, knownIds) {
  if (!Array.isArray(raw)) return null;
  const ids = new Set(knownIds);
  const out = [];
  for (const x of raw) {
    if (!x || !ids.has(x.id)) continue;
    let s = Number.isFinite(Number(x.score)) ? Math.round(Number(x.score)) : 0;
    s = Math.max(0, Math.min(100, s));
    out.push({
      id: x.id,
      score: s,
      reason: typeof x.reason === "string" ? x.reason.slice(0, 200) : "",
      model: MODEL,
    });
  }
  return out;
}

/**
 * Prova la normalizzazione AI; se non disponibile o fallisce, ricade sul
 * fallback deterministico (mai null/undefined, sempre un array).
 */
export async function scoreChainCandidates(wantListing, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  if (!client) return heuristicChainScore(wantListing, candidates);

  const sorted = candidates.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const allIds = sorted.map((c) => c.id);
  const results = [];

  for (let i = 0; i < sorted.length; i += MAX_CANDIDATES_PER_CALL) {
    const batch = sorted.slice(i, i + MAX_CANDIDATES_PER_CALL);
    const prompt = buildChainPrompt(wantListing, batch);
    const raw = await callOpenAIChainScore(prompt, CHAIN_AI_TIMEOUT_MS);
    const validated = validateChainScores(raw, batch.map((c) => c.id));
    if (!validated || !validated.length) {
      // un batch fallito -> ricadi sull'euristica per l'intero lotto di candidati
      return heuristicChainScore(wantListing, candidates);
    }
    results.push(...validated);
  }

  const byId = new Map(results.map((r) => [r.id, r]));
  return allIds
    .map((id) => byId.get(id) || { id, score: 0, reason: "", model: MODEL })
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
}

export const CHAIN_SCORE_PASS_THRESHOLD = CHAIN_SCORE_THRESHOLD;
