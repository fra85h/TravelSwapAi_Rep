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

function buildPrompt(user, listingsBatch) {
  // prova a leggere da più posti; non forzare default sbagliati
  const userMode = user?.cerco_vendo ?? user?.prefs?.cerco_vendo ?? null;

  const slimUser = { id: user?.id, prefs: user?.prefs ?? {}, cerco_vendo: userMode };

  const slimListings = listingsBatch.map((l) => ({
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
    description: truncate(normText(l.description), MAX_DESC_CHARS),
  }));

  return `Sei un motore di matching.
Compito: per ciascun listing calcola "score" (0–100) e imposta "bidirectional" quando c'è reciprocità forte con l'UTENTE.

Rispondi SOLO con:
{
  "scores": [
    { "id": "<uuid>", "score": <int 0-100>, "bidirectional": <true|false>, "explanation": "<max 140 char>" }
  ]
}

Regole vincolanti:
- Un elemento in "scores" per OGNI listing (nessuna omissione).
- "score" intero 0..100.
- "bidirectional" = true SOLO se (user.cerco_vendo e listing.cerco_vendo sono complementari) E (route_from→route_to e data/ora coincidono o sono nello stesso giorno). Altrimenti false.
- Se user.cerco_vendo è null o listing.cerco_vendo è null ⇒ bidirectional=false.
- Considera route_from/route_to e le date: stessa direzione e stesso giorno aumentano molto lo score; disallineamenti lo riducono.
- Linee guida score: 60=base, 70=buona, 80+=eccellente.

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
      timeoutMs: 15000,
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

  completed.sort((a, b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
  return completed;
}

/**
 * Fallback deterministico se l’AI non risponde:
 * +15 se type matcha preferenze
 * +10 se price <= maxPrice
 * +10 se location contiene la preferenza location (case-insensitive)
 */
export function heuristicScore(user, listings) {
  const prefs = user?.prefs || {};
  const types = new Set(Array.isArray(prefs.types) ? prefs.types : []);
  const maxPrice = Number.isFinite(Number(prefs.maxPrice))
    ? Number(prefs.maxPrice)
    : 1e9;
  const loc = String(prefs.location || "").toLowerCase();

  return (listings || [])
    .map((l) => {
      let s = 60; // base
      if (l?.type && types.has(l.type)) s += 15;
      if (l?.price != null && Number(l.price) <= maxPrice) s += 10;
      if (loc && String(l?.location || "").toLowerCase().includes(loc))
        s += 10;

      // clamp & int
      s = Math.max(0, Math.min(100, Math.round(s)));
      return { id: l.id, score: s, bidirectional: s >= 80, model: "heuristic" };
    })
    .sort(
      (a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))
    );
}
