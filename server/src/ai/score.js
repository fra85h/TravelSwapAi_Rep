// server/src/ai/score.js
import OpenAI from "openai";

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------
const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Override via env
const MODEL = process.env.MATCH_AI_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.MATCH_AI_TEMP ?? 0); // default: deterministico
const TOP_P = Number(process.env.MATCH_AI_TOP_P ?? 1);
const MAX_LISTINGS_PER_CALL = Number(process.env.MATCH_AI_BATCH ?? 40);
const MATCH_AI_TIMEOUT_MS = Number(process.env.MATCH_AI_TIMEOUT_MS ?? 45000); // default 45s


// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------
const MAX_DESC_CHARS = 300; // riduce token cost
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(v => stableStringify(v)).join(",")}]`;
  const keys = Object.keys(value).sort(); // <-- ordine chiavi
  const body = keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",");
  return `{${body}}`;
}

function normText(s) {
  if (!s) return "";
  return String(s).replace(/\s+/g, " ").trim(); // spazi stabili
}

function truncate(str, n) {
  if (!str) return "";
  const s = String(str);
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function toISOorNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

// L'ANNUNCIO SORGENTE dell'utente è il vero termine di paragone del match:
// senza di esso l'AI valutava alla cieca (bug storico: veniva passato come
// user.fromListing ma mai letto, quindi rotta/tipo/cerco_vendo dell'utente
// non arrivavano mai al modello e la reciprocità CERCO↔VENDO era morta).
function slimListing(l) {
  return {
    id: l.id,
    title: truncate(normText(l.title), 120),
    type: l.type,
    cerco_vendo: l.cerco_vendo ?? null,
    route_from: l.route_from ?? null,
    route_to: l.route_to ?? null,
    depart_at: toISOorNull(l.depart_at ?? l.departAt),
    arrive_at: toISOorNull(l.arrive_at ?? l.arriveAt),
    location: truncate(normText(l.location), 80),
    price: l.price,
    // Scambio reale (B): un VENDO può dichiarare di accettare uno scambio e
    // COSA cerca in cambio (swap_wanted). Serve al modello per abbinare due
    // VENDO che si incastrano (io ho X e voglio Y; tu hai Y e vuoi X).
    accepts_swap: !!(l.accepts_swap),
    swap_wanted: l.swap_wanted ?? null,
    description: truncate(normText(l.description), MAX_DESC_CHARS),
  };
}

function buildPrompt(user, listingsBatch) {
  const from = user?.fromListing ? slimListing(user.fromListing) : null;
  const slimUser = { id: user?.id, prefs: user?.prefs ?? {} };
  const slimListings = listingsBatch.map(slimListing);

  return `Sei un motore di matching per un marketplace di viaggi (treni/hotel).
L'utente ha pubblicato l'ANNUNCIO SORGENTE qui sotto. Per ciascun listing candidato calcola quanto è un buon abbinamento PER QUELL'ANNUNCIO.

Rispondi SOLO con:
{
  "scores": [
    { "id": "<uuid>", "score": <int 0-100>, "bidirectional": <true|false>, "explanation": "<max 140 char>" }
  ]
}

Regole vincolanti:
- Un elemento in "scores" per OGNI listing (nessuna omissione).
- "score" intero 0..100.
- La complementarità è il criterio principale: se l'annuncio sorgente è CERCO, i candidati VENDO equivalenti valgono molto (e viceversa). Due annunci con lo stesso cerco_vendo NON sono complementari, TRANNE nel caso di SCAMBIO qui sotto.
- SCAMBIO REALE tra due VENDO: se il sorgente è VENDO con accepts_swap=true, ciò che cerca in cambio è nel campo swap_wanted (tratta from→to per treno, oppure location per hotel). Un candidato VENDO che OFFRE proprio ciò che il sorgente cerca (la sua tratta/località coincide con swap_wanted del sorgente, stesso type) è un buon match di scambio (score alto). Se ANCHE il candidato ha accepts_swap=true e il suo swap_wanted coincide con ciò che il sorgente offre, lo scambio è RECIPROCO (bidirectional=true, score 90+).
- IMPORTANTE: la vicinanza di DATA/ORARIO e la differenza di PREZZO/budget vengono valutate SEPARATAMENTE, in modo deterministico, DOPO di te. NON abbassare lo score per date diverse o prezzi diversi: uno scarto di pochi giorni o un prezzo un po' più alto NON devono azzerare il match. Valuta SOLO: complementarità (CERCO↔VENDO o incastro di SCAMBIO), stesso tipo, stessa tratta/località.
- "bidirectional" = true SOLO se: (a) cerco_vendo complementari (CERCO↔VENDO), stesso type, stessa tratta/località; OPPURE (b) scambio reciproco tra due VENDO come descritto sopra. Le date NON entrano in questa condizione. Altrimenti false.
- Se cerco_vendo del sorgente o del candidato è null ⇒ bidirectional=false.
- Tipo diverso dal sorgente (train vs hotel) ⇒ score basso (max 30).
- Stessa tratta/direzione alza molto lo score; tratta diversa o direzione inversa lo riduce.
- Linee guida score: <=30 irrilevante, 50=debole, 70=buona, 85+=eccellente, 90+=reciproco quasi perfetto.
- "explanation" in italiano, breve e concreta (es. "VENDO complementare al tuo CERCO, stessa tratta Roma→Vienna").

AnnuncioSorgente: ${stableStringify(from)}
Utente: ${stableStringify(slimUser)}
Listings: ${stableStringify(slimListings)}`;
}


// Valida e normalizza output AI (senza "model": lo aggiungiamo noi)
function validateAndNormalize(aiArrayOrNull, knownIds) {
  const aiArray = Array.isArray(aiArrayOrNull) ? aiArrayOrNull : null;
  if (!aiArray) return null;

  const ids = new Set(knownIds);
  const out = [];
  for (const x of aiArray) {
    if (!x || !ids.has(x.id)) continue;
    let s = Number.isFinite(Number(x.score)) ? Math.round(Number(x.score)) : 0;
    if (s < 0) s = 0;
    if (s > 100) s = 100;
    const explanation = typeof x.explanation === "string"
      ? x.explanation.replace(/\s+/g, " ").trim().slice(0, 200)
      : "";

    out.push({
      id: x.id,
      score: s,
      bidirectional: !!x.bidirectional,
      explanation
    });
  }

  // dedup + sort deterministico
  const seen = new Set();
  const dedup = [];
  for (const r of out) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    dedup.push(r);
  }
  dedup.sort((a, b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
  return dedup;
}



// -----------------------------------------------------------------------------
// Responses API wrapper con text.format (schema) + fallback "json"
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Responses API wrapper con text.format (schema) + fallback "json" + fallback plain
// -----------------------------------------------------------------------------
// ✅ Usa json_schema (root: array) – niente "json"
// Usa un modello che supporta bene structured outputs.
// Se puoi: MATCH_AI_MODEL=gpt-4o-mini
async function callOpenAIJSON({
  prompt,
  timeoutMs = MATCH_AI_TIMEOUT_MS,
  model = MODEL,
  temperature = TEMPERATURE,
  top_p = TOP_P,
}) {
  if (!client) return null;

  // piccolo helper per capire se vale la pena ritentare
  const shouldRetry = (e, status) => {
    if (!e) return false;
    const msg = String(e?.message || e || "");
    if (/abort|timeout/i.test(msg)) return true;   // AbortError / timeout
    if (status && Number(status) >= 500) return true; // 5xx
    return false;
  };

  let attempt = 0;
  const maxAttempts = 2; // 1 try + 1 retry soft

  while (attempt < maxAttempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);

    try {
      const resp = await client.responses.create({
        model,
        input: prompt,
        temperature,
        top_p,
        text: {
          format: {
            type: "json_schema",
            name: "scores_payload",
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
                    required: ["id", "score", "bidirectional", "explanation"],
                    properties: {
                      id:            { type: "string" },
                      score:         { type: "integer", minimum: 0, maximum: 100 },
                      bidirectional: { type: "boolean" },
                      explanation:   { type: "string", maxLength: 160 },
                    },
                  },
                },
              },
            },
          },
        },
      }, { signal: ctrl.signal });

      clearTimeout(timer);

      // estrai testo in modo robusto
      let text = "";
      if (typeof resp?.output_text === "string") {
        text = resp.output_text;
      } else if (Array.isArray(resp?.output)) {
        const c = resp.output[0]?.content?.[0];
        if (c?.type === "output_text") text = c.text || "";
        if (c?.type === "message")     text = c.content?.[0]?.text || "";
      }
      if (!text.trim()) return null;

      // parse → estrai l’array dentro "scores"
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (Array.isArray(parsed)) return parsed; // retrocompat array puro
      if (parsed && Array.isArray(parsed.scores)) return parsed.scores;

      // ultima spiaggia: estrai il primo array
      const m = text.match(/\[[\s\S]*\]/);
      if (m) {
        try {
          const arr = JSON.parse(m[0]);
          return Array.isArray(arr) ? arr : null;
        } catch {}
      }
      return null;
    } catch (e) {
      clearTimeout(timer);
      const status = e?.status;
      const msg = String(e?.message || e || "");
      const aborted = /abort|timeout/i.test(msg);
      console.error("[AI] OpenAI error:", status, msg, aborted ? "(aborted)" : "");

      if (attempt + 1 < maxAttempts && shouldRetry(e, status)) {
        // backoff molto leggero per evitare picchi (non cambia l'API)
        await new Promise(r => setTimeout(r, 500));
        attempt++;
        continue;
      }
      return null;
    }
  }

  return null;
}


export async function scoreWithAI(user, listings) {
  if (!client || !Array.isArray(listings) || listings.length === 0) return null;

  const sorted = listings.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const allIds = sorted.map(l => l.id);

  const batches = [];
  for (let i = 0; i < sorted.length; i += MAX_LISTINGS_PER_CALL) {
    batches.push(sorted.slice(i, i + MAX_LISTINGS_PER_CALL));
  }

  const results = [];
  for (const batch of batches) {
    const prompt = buildPrompt(user, batch);
    const raw = await callOpenAIJSON({
      prompt,
      timeoutMs: MATCH_AI_TIMEOUT_MS,
      model: MODEL,
      temperature: TEMPERATURE,
      top_p: TOP_P,
    });
    const validated = validateAndNormalize(raw, batch.map(l => l.id));
    if (validated && validated.length) {
      results.push(...validated.map(r => ({ ...r, model: MODEL })));
    } else {
      // se lo schema fallisce per il batch, interrompi e vai a heuristic (deterministico)
      return null;
    }
  }

  // completa buchi
  const byId = new Map(results.map(r => [r.id, r]));
  const completed = allIds.map(id => byId.get(id) || { id, score: 0, bidirectional: false, model: MODEL });

  // Guardrail deterministico: non fidarsi ciecamente del bidirectional
  // dichiarato dall'AI, verificarlo strutturalmente (vedi structuralBidirectional).
  const f = user?.fromListing || null;
  const listingById = new Map(sorted.map(l => [l.id, l]));
  const guarded = completed.map(r => (
    r.bidirectional && !structuralBidirectional(f, listingById.get(r.id))
      ? { ...r, bidirectional: false }
      : r
  ));

  guarded.sort((a, b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
  return guarded;
}

/**
 * Fallback deterministico se l'AI non risponde.
 * Con user.fromListing (percorso reale in produzione): confronta il
 * candidato con l'ANNUNCIO SORGENTE — complementarità CERCO↔VENDO,
 * stesso tipo, stessa tratta, stesso giorno.
 * Senza fromListing (percorso legacy/prefs): comportamento storico
 * basato sulle preferenze utente.
 */
const normPlace = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

function routeOf(l) {
  let a = normPlace(l?.route_from);
  let b = normPlace(l?.route_to);
  if (!a || !b) {
    const parts = String(l?.location || "").split(/-->|→/);
    if (parts.length === 2) {
      a = a || normPlace(parts[0]);
      b = b || normPlace(parts[1]);
    }
  }
  return [a, b];
}

function dayOf(l) {
  const v = l?.depart_at ?? l?.departAt ?? l?.check_in ?? l?.checkIn ?? null;
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

// Scambio reale (B): cosa un VENDO cerca in cambio (swap_wanted), normalizzato.
function swapWantedOf(l) {
  const w = l?.swap_wanted || null;
  if (!w || typeof w !== "object") return null;
  return { a: normPlace(w.from), b: normPlace(w.to), loc: normPlace(w.location) };
}

// Il candidato OFFRE ciò che `wanted` chiede? (per treno confronta la tratta,
// per hotel la località). Serve una richiesta esplicita: senza tratta/località
// non si evoca uno scambio, per non inondare di falsi positivi.
function offersWhatWanted(cand, wanted, type) {
  if (!wanted) return false;
  if (String(type).toLowerCase() === "hotel") {
    return !!wanted.loc && normPlace(cand?.location) === wanted.loc;
  }
  const [ca, cb] = routeOf(cand);
  return !!(wanted.a && wanted.b && ca && cb && ca === wanted.a && cb === wanted.b);
}

// Verifica strutturale e deterministica di "bidirectional", usata come
// guardrail sul flag restituito dall'AI: a differenza dello score (corretto
// SEMPRE da adjustedScore), bidirectional veniva preso per buono così com'è
// dall'LLM, senza alcun vincolo di codice — un'allucinazione poteva marcare
// come reciproco un match strutturalmente sbagliato (tipo o tratta diversi).
// Stesse regole del prompt/di heuristicScore: complementari CERCO↔VENDO con
// stesso tipo e stessa tratta/località, oppure scambio reciproco reale tra
// due VENDO.
function structuralBidirectional(f, l) {
  if (!f || !l) return false;
  const fCV = String(f.cerco_vendo || "").toUpperCase();
  const lCV = String(l.cerco_vendo || "").toUpperCase();
  if (!fCV || !lCV) return false;
  const fType = String(f.type || "").toLowerCase();
  const lType = String(l.type || "").toLowerCase();
  if (!fType || fType !== lType) return false;

  const [fA, fB] = routeOf(f);
  const [lA, lB] = routeOf(l);
  const sameRoute = !!(fA && fB && lA && lB && fA === lA && fB === lB);
  const sameHotelLoc = fType === "hotel" && !!normPlace(f.location) && normPlace(f.location) === normPlace(l.location);

  const compCV = fCV === "CERCO" ? "VENDO" : fCV === "VENDO" ? "CERCO" : null;
  if (compCV && lCV === compCV && (sameRoute || sameHotelLoc)) return true;

  const bothVendo = fCV === "VENDO" && lCV === "VENDO";
  if (!bothVendo) return false;
  const fWantsL = !!f.accepts_swap && offersWhatWanted(l, swapWantedOf(f), lType);
  const lWantsF = !!l.accepts_swap && offersWhatWanted(f, swapWantedOf(l), fType);
  return fWantsL && lWantsF;
}

// -----------------------------------------------------------------------------
// Modificatore deterministico budget + prossimità data (Fase 2)
// -----------------------------------------------------------------------------
// Applica un fattore 0..1 al punteggio base (AI o euristico) in base a due
// segnali NUMERICI, calcolati con precisione invece di affidarli all'LLM:
//   • budget: per un annuncio CERCO il campo `price` è il budget massimo. Se il
//     VENDO abbinato costa ENTRO budget → nessuna penalità; più sfora, più cala.
//   • data/ora: più le date principali (partenza / check-in) sono lontane, più
//     il punteggio cala (stesso momento = nessuna penalità).
// Pesi moderati: nel caso peggiore il punteggio si dimezza, così un match
// strutturale forte (tratta/tipo/complementarità) resta comunque rilevante.
// Data: c'è una TOLLERANZA piena entro DATE_GRACE_DAYS (un match a 1 giorno di
// distanza non viene penalizzato), poi un calo GRADUALE fino a DATE_WINDOW_DAYS.
// Anche a distanza massima il match non si azzera: il peso DATE_WEIGHT limita la
// riduzione (al più −25%). Lo zero secco che si vedeva veniva dall'AI, non da qui.
const DATE_GRACE_DAYS  = Number(process.env.MATCH_DATE_GRACE_DAYS ?? 1);    // entro N giorni → nessuna penalità
const DATE_WINDOW_DAYS = Number(process.env.MATCH_DATE_WINDOW_DAYS ?? 14);  // oltre la grazia, calo lineare su N giorni
const BUDGET_TOLERANCE = Number(process.env.MATCH_BUDGET_TOLERANCE ?? 0.5); // +50% oltre budget → fit 0
const PRICE_WEIGHT = Number(process.env.MATCH_PRICE_WEIGHT ?? 0.25);
const DATE_WEIGHT  = Number(process.env.MATCH_DATE_WEIGHT ?? 0.25);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateMs(l) {
  const v = l?.depart_at ?? l?.departAt ?? l?.check_in ?? l?.checkIn ?? null;
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

// 0..1: 1 se il prezzo di vendita è entro il budget del CERCO, cala oltre.
// Neutro (1) se manca un dato o non c'è una coppia compratore/venditore chiara.
export function priceFit(f, l) {
  const fCV = String(f?.cerco_vendo || "").toUpperCase();
  const lCV = String(l?.cerco_vendo || "").toUpperCase();
  let budget = null, sale = null;
  if (fCV === "CERCO" && lCV === "VENDO") { budget = num(f?.price); sale = num(l?.price); }
  else if (fCV === "VENDO" && lCV === "CERCO") { budget = num(l?.price); sale = num(f?.price); }
  else return 1; // stesso cerco_vendo o campi mancanti: prezzo non confrontabile
  if (budget == null || sale == null || budget <= 0) return 1;
  if (sale <= budget) return 1;
  const over = (sale - budget) / (budget * BUDGET_TOLERANCE);
  return Math.max(0, 1 - over);
}

// 0..1: 1 entro DATE_GRACE_DAYS (tolleranza piena), poi calo lineare fino a 0 a
// DATE_GRACE_DAYS + DATE_WINDOW_DAYS. Neutro (1) se manca una data.
export function dateFit(f, l) {
  const a = dateMs(f), b = dateMs(l);
  if (a == null || b == null) return 1; // se manca una data, nessuna penalità
  const days = Math.abs(a - b) / 86400000;
  if (days <= DATE_GRACE_DAYS) return 1; // qualche giorno di tolleranza
  const decay = (days - DATE_GRACE_DAYS) / DATE_WINDOW_DAYS;
  return Math.max(0, 1 - decay);
}

// Fattore combinato 0..1 da applicare al punteggio base.
export function budgetDateFactor(f, l) {
  if (!f || !l) return 1;
  const p = priceFit(f, l);
  const d = dateFit(f, l);
  const factor = 1 - PRICE_WEIGHT * (1 - p) - DATE_WEIGHT * (1 - d);
  return Math.max(0, Math.min(1, factor));
}

// Punteggio finale = base × fattore, arrotondato a INTERO. La colonna
// matches.score è di tipo integer: senza arrotondamento l'insert fallirebbe
// (Postgres rifiuta un valore frazionario come "48.172" con un 400).
export function adjustedScore(baseScore, f, l) {
  return Math.round(Number(baseScore || 0) * budgetDateFactor(f, l));
}

export function heuristicScore(user, listings) {
  const f = user?.fromListing || null;

  if (f) {
    const fCV = String(f.cerco_vendo || "").toUpperCase();
    const compCV = fCV === "CERCO" ? "VENDO" : fCV === "VENDO" ? "CERCO" : null;
    const fType = String(f.type || "").toLowerCase();
    const [fA, fB] = routeOf(f);
    const fLoc = normPlace(f.location);

    return (listings || [])
      .map((l) => {
        const lCV = String(l?.cerco_vendo || "").toUpperCase();
        const lType = String(l?.type || "").toLowerCase();
        const [lA, lB] = routeOf(l);

        const sameType = !!fType && lType === fType;
        const complementary = !!compCV && lCV === compCV;
        const sameRoute = fA && fB && lA && lB && fA === lA && fB === lB;
        const reverseRoute = fA && fB && lA && lB && fA === lB && fB === lA;
        const sameHotelLoc = fType === "hotel" && fLoc && normPlace(l?.location) === fLoc;

        // Scambio reale (B): entrambi VENDO, stesso tipo. Il sorgente cerca in
        // cambio ciò che il candidato offre? e (reciprocità) il candidato cerca
        // ciò che il sorgente offre? Uno scambio reciproco è il match migliore.
        const bothVendo = fCV === "VENDO" && lCV === "VENDO";
        const fWantsL = bothVendo && sameType && !!f?.accepts_swap && offersWhatWanted(l, swapWantedOf(f), lType);
        const lWantsF = bothVendo && sameType && !!l?.accepts_swap && offersWhatWanted(f, swapWantedOf(l), fType);
        const swapMutual = fWantsL && lWantsF;
        const swapOneWay = fWantsL || lWantsF;

        // Il punteggio base è STRUTTURALE (tipo, complementarità, tratta). La
        // vicinanza di data e il budget sono applicati dopo, in modo
        // deterministico, da budgetDateFactor — così la data non è contata due
        // volte e uno scarto di pochi giorni non azzera il match.
        let s = 35; // base: senza alcuna affinità il candidato è poco rilevante
        if (sameType) s += 15;
        if (complementary) s += 20;
        if (sameRoute || sameHotelLoc) s += 20;
        else if (reverseRoute) s += 8;
        if (!sameType) s = Math.min(s, 30); // tipo diverso: mai oltre "irrilevante"

        // Lo scambio si somma sopra alla base strutturale: reciproco = eccellente,
        // a senso unico = buono (il candidato ha ciò che cerchi, ma non ha ancora
        // dichiarato di volere ciò che offri tu).
        if (swapMutual) s = Math.max(s, 92);
        else if (swapOneWay) s = Math.max(s, 72);

        const bidirectional = (complementary && sameType && (sameRoute || sameHotelLoc)) || swapMutual;
        if (bidirectional && !swapMutual) s = Math.max(s, 90);

        s = Math.max(0, Math.min(100, Math.round(s)));
        const explanation = swapMutual
          ? `Scambio reciproco: ha ciò che cerchi e cerca ciò che offri`
          : swapOneWay
            ? `Possibile scambio: offre ciò che cerchi in cambio`
            : bidirectional
              ? `${lCV} complementare al tuo ${fCV}, stessa ${fType === "hotel" ? "località" : "tratta"}`
              : "";
        return { id: l.id, score: s, bidirectional, model: "heuristic", explanation };
      })
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  }

  // ---- percorso legacy (nessun fromListing): preferenze utente ----
  const prefs = user?.prefs || {};
  const types = new Set(Array.isArray(prefs.types) ? prefs.types : []);
  const maxPrice = Number.isFinite(Number(prefs.maxPrice))
    ? Number(prefs.maxPrice)
    : 1e9;
  // Preferenze località/tratte: ora supporta PIÙ zone (prefs.locations[]),
  // con retrocompatibilità sul vecchio singolo prefs.location. Ogni voce
  // separata è confrontata sia con la località hotel sia con la tratta treno
  // (route_from/route_to composta in location "A → B").
  const prefLocs = (Array.isArray(prefs.locations) ? prefs.locations : [prefs.location])
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);

  return (listings || [])
    .map((l) => {
      let s = 60; // base
      if (l?.type && types.has(l.type)) s += 15;
      if (l?.price != null && Number(l.price) <= maxPrice) s += 10;
      // Peso località alzato (10 → 15) e su più zone: le preferenze devono
      // pesare di più nel far emergere in Esplora i risultati giusti.
      const hay = String(l?.location || "").toLowerCase();
      if (prefLocs.length && prefLocs.some((p) => hay.includes(p))) s += 15;

      // clamp & int
      s = Math.max(0, Math.min(100, Math.round(s)));
      return { id: l.id, score: s, bidirectional: s >= 80, model: "heuristic" };
    })
    .sort(
      (a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))
    );
}
