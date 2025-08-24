// server/src/ai/score.js
import OpenAI from "openai";

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------
const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Override via env
const MODEL = process.env.MATCH_AI_MODEL || "gpt-4.1-mini";
const TEMPERATURE = Number(process.env.MATCH_AI_TEMP ?? 0); // default: deterministico
const TOP_P = Number(process.env.MATCH_AI_TOP_P ?? 1);
const MAX_LISTINGS_PER_CALL = Number(process.env.MATCH_AI_BATCH ?? 40);

// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------
const MAX_DESC_CHARS = 300; // riduce token cost

function truncate(str, n) {
  if (!str) return "";
  const s = String(str);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function buildPrompt(user, listingsBatch) {
  // Minimizza il prompt, solo i campi che servono
  const slimUser = {
    id: user?.id,
    prefs: user?.prefs ?? {},
  };
  const slimListings = listingsBatch.map((l) => ({
    id: l.id,
    title: truncate(l.title, 120),
    type: l.type,
    location: truncate(l.location, 80),
    price: l.price,
    description: truncate(l.description, MAX_DESC_CHARS),
  }));

  // Istruzioni chiare + richiesta SOLO JSON
  return `Sei un motore di matching. Assegna a ciascun listing un punteggio di compatibilità 0-100 con l'utente.
Rispondi SOLO con un array JSON, senza testo extra, nel formato esatto:
[
  { "id": "<uuid>", "score": <int 0-100>, "bidirectional": <true|false> },
  ...
]

Regole:
- Restituisci un oggetto per OGNI listing ricevuto.
- "score" è intero tra 0 e 100. 
- "bidirectional" true se è probabile l'interesse reciproco; altrimenti false.
- Non aggiungere campi extra.

Utente: ${JSON.stringify(slimUser)}
Listings: ${JSON.stringify(slimListings)}`;
}

// Valida e normalizza output AI (senza "model": lo aggiungiamo noi)
function validateAndNormalize(aiArray, knownIds) {
  if (!Array.isArray(aiArray)) return null;
  const ids = new Set(knownIds);
  const out = [];
  for (const x of aiArray) {
    if (!x || !ids.has(x.id)) continue;
    let s = Number.isFinite(Number(x.score)) ? Math.round(Number(x.score)) : 0;
    if (s < 0) s = 0;
    if (s > 100) s = 100;
    out.push({
      id: x.id,
      score: s,
      bidirectional: !!x.bidirectional,
    });
  }
  // dedup + sort deterministico (score DESC, id ASC)
  const seen = new Set();
  const dedup = [];
  for (const r of out) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    dedup.push(r);
  }
  dedup.sort(
    (a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))
  );
  return dedup;
}

// -----------------------------------------------------------------------------
// Responses API wrapper con text.format (schema) + fallback "json"
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Responses API wrapper con text.format (schema) + fallback "json" + fallback plain
// -----------------------------------------------------------------------------
async function callOpenAIJSON({
  prompt,
  timeoutMs = 12000,
  retries = 1,
  model = MODEL,
  temperature = TEMPERATURE,
  top_p = TOP_P,
}) {
  if (!client) return null;

  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve({ output_text: "" }), timeoutMs)
  );

  // 1) Structured Outputs (schema rigoroso)
  const reqSchema = {
    model,
    input: prompt,
    temperature,
    top_p,
    text: {
      format: {
        type: "json_schema",
        json_schema: {
          name: "scores",
          strict: true,
          schema: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "score", "bidirectional"],
              properties: {
                id:            { type: "string" },
                score:         { type: "integer", minimum: 0, maximum: 100 },
                bidirectional: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  };

  // 2) Fallback “voglio JSON” (⚠️ nota: qui serve un OGGETTO, non una stringa)
  const reqJson = {
    model,
    input: prompt,
    temperature,
    top_p,
    text: { format: { type: "json" } },   // <-- FIX qui
  };

  // 3) Fallback plain (niente text.format) + parser “estrai [ … ]”
  const reqPlain = {
    model,
    input: prompt,
    temperature,
    top_p,
  };

  async function create(req) {
    return client.responses.create(req);
  }

  let resp;
  // tenta schema
  try {
    resp = await Promise.race([create(reqSchema), timeout]);
  } catch {
    // tenta json
    try {
      resp = await Promise.race([create(reqJson), timeout]);
    } catch {
      // tenta plain
      resp = await Promise.race([create(reqPlain), timeout]);
    }
  }

  let text = resp?.output_text || "";

  // retry soft se non pare un array JSON
  for (let i = 0; i < retries && text.trim()[0] !== "["; i++) {
    try {
      resp = await Promise.race([create(reqSchema), timeout]);
    } catch {
      try {
        resp = await Promise.race([create(reqJson), timeout]);
      } catch {
        resp = await Promise.race([create(reqPlain), timeout]);
      }
    }
    text = resp?.output_text || "";
  }

  // parsing robusto
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch {}
    }
  }
  return parsed;
}


// -----------------------------------------------------------------------------
// AI score (pubblico)
// -----------------------------------------------------------------------------
export async function scoreWithAI(user, listings) {
  if (!client || !Array.isArray(listings) || listings.length === 0) return null;

  // Ordine canonico per stabilità
  const sorted = listings
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const allIds = sorted.map((l) => l.id);

  // Batch
  const batches = [];
  for (let i = 0; i < sorted.length; i += MAX_LISTINGS_PER_CALL) {
    batches.push(sorted.slice(i, i + MAX_LISTINGS_PER_CALL));
  }

  const results = [];
  for (const batch of batches) {
    const prompt = buildPrompt(user, batch);
    const raw = await callOpenAIJSON({
      prompt,
      timeoutMs: 12000,
      retries: 1,
      model: MODEL,
      temperature: TEMPERATURE,
      top_p: TOP_P,
    });
    const validated = validateAndNormalize(
      raw,
      batch.map((l) => l.id)
    );
    if (validated && validated.length) {
      // 🔖 aggiungiamo qui il campo "model"
      results.push(...validated.map((r) => ({ ...r, model: MODEL })));
    }
  }

  if (!results.length) {
    console.warn("[scoreWithAI] empty result from AI, falling back to heuristic");
    return null;
  }

  // Colma eventuali buchi: tutti gli ID presenti con un record
  const byId = new Map(results.map((r) => [r.id, r]));
  const completed = allIds.map((id) => {
    const r = byId.get(id);
    return r || { id, score: 0, bidirectional: false, model: MODEL };
  });

  // Ordina finale (deterministico)
  completed.sort(
    (a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))
  );
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
