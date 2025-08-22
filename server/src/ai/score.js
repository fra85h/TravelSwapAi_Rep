// server/src/ai/score.js
import OpenAI from "openai/index.mjs";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ----- Utility ---------------------------------------------------------------

const MAX_DESC_CHARS = 300;   // riduce token cost
const MAX_LISTINGS_PER_CALL = 40; // batch per carichi grandi
const MODEL = "gpt-4.1-mini"; // puoi switchare qui
const TEMPERATURE = 0.1;

function truncate(str, n) {
  if (!str) return "";
  return String(str).length > n ? String(str).slice(0, n) + "…" : String(str);
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

// Valida e normalizza output AI
function validateAndNormalize(aiArray, knownIds) {
  if (!Array.isArray(aiArray)) return null;
  const ids = new Set(knownIds);
  const out = [];
  for (const x of aiArray) {
    if (!x || !ids.has(x.id)) continue;
    let s = Number.isFinite(x.score) ? Math.round(Number(x.score)) : 0;
    if (s < 0) s = 0;
    if (s > 100) s = 100;
    out.push({
      id: x.id,
      score: s,
      bidirectional: !!x.bidirectional,
    });
  }
  // dedup + ordina deterministico su (score desc, id asc)
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

async function callOpenAIJSON({ prompt, timeoutMs = 12000, retries = 1 }) {
  if (!client) return null;

  // “timeout manuale”
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve({ output_text: "" }), timeoutMs)
  );

  // Se il modello supporta response_format JSON, usiamolo; altrimenti fallback.
  const req = client.responses.create({
    model: MODEL,
    input: prompt,
    temperature: TEMPERATURE,
    // Se il SDK supporta lo schema JSON nativo, scommenta questo blocco:
    // response_format: {
    //   type: "json_schema",
    //   json_schema: {
    //     name: "scores",
    //     schema: {
    //       type: "array",
    //       items: {
    //         type: "object",
    //         required: ["id", "score", "bidirectional"],
    //         properties: {
    //           id: { type: "string" },
    //           score: { type: "integer", minimum: 0, maximum: 100 },
    //           bidirectional: { type: "boolean" }
    //         }
    //       }
    //     }
    //   }
    // },
  });

  let resp = await Promise.race([req, timeout]);
  let text = resp?.output_text || "";

  // Retry “soft” se non pare JSON
  for (let i = 0; i < retries && text.trim()[0] !== "["; i++) {
    resp = await Promise.race([client.responses.create({
      model: MODEL,
      input: prompt,
      temperature: TEMPERATURE,
    }), timeout]);
    text = resp?.output_text || "";
  }

  // Parsing robusto: prova JSON diretto, altrimenti estrai il primo array con regex
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // estrai il primo blocco [ ... ] se il modello ha aggiunto testo
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
    }
  }
  return parsed;
}

// ----- AI score (pubblico) ---------------------------------------------------

export async function scoreWithAI(user, listings) {
  if (!client || !Array.isArray(listings) || listings.length === 0) return null;

  // Batch se necessario
  const allIds = listings.map((l) => l.id);
  const batches = [];
  for (let i = 0; i < listings.length; i += MAX_LISTINGS_PER_CALL) {
    batches.push(listings.slice(i, i + MAX_LISTINGS_PER_CALL));
  }

  const results = [];
  for (const batch of batches) {
    const prompt = buildPrompt(user, batch);
    const raw = await callOpenAIJSON({ prompt, timeoutMs: 12000, retries: 1 });
    const validated = validateAndNormalize(raw, batch.map((l) => l.id));
    if (validated && validated.length) results.push(...validated);
  }

  if (!results.length) return null;

  // Colma eventuali buchi (l'AI deve restituire tutti gli ID; se manca qualcosa, metti score basso)
  const byId = new Map(results.map((r) => [r.id, r]));
  const completed = allIds.map((id) => {
    const r = byId.get(id);
    return r || { id, score: 0, bidirectional: false };
  });

  // Ordina finale deterministico
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
  const maxPrice = Number.isFinite(Number(prefs.maxPrice)) ? Number(prefs.maxPrice) : 1e9;
  const loc = String(prefs.location || "").toLowerCase();

  return (listings || []).map((l) => {
    let s = 60; // base
    if (l?.type && types.has(l.type)) s += 15;
    if (l?.price != null && Number(l.price) <= maxPrice) s += 10;
    if (loc && String(l?.location || "").toLowerCase().includes(loc)) s += 10;

    // clamp & int
    s = Math.max(0, Math.min(100, Math.round(s)));
    return { id: l.id, score: s, bidirectional: s >= 80 };
  }).sort((a, b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
}
