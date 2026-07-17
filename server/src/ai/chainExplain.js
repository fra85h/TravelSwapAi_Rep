// server/src/ai/chainExplain.js
// Fase 3 dello swap a catena: spiegazione in linguaggio naturale di una
// proposta trovata, da mostrare all'utente ("il tuo biglietto non ha un
// match diretto, ma con altri 2 utenti si chiude uno scambio che
// accontenta tutti"). Stesso pattern di resilienza delle altre due fasi
// AI (score.js, chainMatch.js): AI primaria, fallback deterministico
// sempre disponibile se la chiave manca o la chiamata fallisce — non è
// mai la spiegazione a bloccare la creazione della proposta.
import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const MODEL = process.env.CHAIN_AI_MODEL || process.env.MATCH_AI_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.CHAIN_AI_TEMP ?? 0);
const CHAIN_EXPLAIN_TIMEOUT_MS = Number(process.env.CHAIN_EXPLAIN_TIMEOUT_MS ?? 10000);

function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

function describeListing(l) {
  if (l?.type === "hotel") {
    const city = l.location || "una destinazione";
    const date = fmtDate(l.check_in);
    return date ? `un soggiorno a ${city} dal ${date}` : `un soggiorno a ${city}`;
  }
  const from = l?.route_from || "?";
  const to = l?.route_to || "?";
  const date = fmtDate(l?.depart_at);
  return date ? `il treno ${from} → ${to} del ${date}` : `il treno ${from} → ${to}`;
}

/**
 * Fallback deterministico, sempre disponibile: descrive meccanicamente i
 * 3 passaggi della catena senza nominare gli utenti (nessun nome reale
 * prima che la catena sia confermata).
 */
export function templateChainExplanation(cycleListings) {
  if (!Array.isArray(cycleListings) || cycleListings.length !== 3) {
    return "Abbiamo trovato uno scambio a 3 che soddisfa tutti i partecipanti.";
  }
  const [a, b, c] = cycleListings;
  return (
    `Il tuo annuncio non aveva un corrispondente diretto, ma abbiamo trovato uno scambio a 3 che chiude tutti i lati: ` +
    `chi dà ${describeListing(a)} riceve ${describeListing(b)}, ` +
    `chi dà ${describeListing(b)} riceve ${describeListing(c)}, ` +
    `e chi dà ${describeListing(c)} riceve ${describeListing(a)}. ` +
    `Lo scambio si chiude solo quando tutti e 3 confermano.`
  );
}

async function callOpenAIExplain(prompt, timeoutMs) {
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
            name: "chain_explanation_payload",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["explanation"],
              properties: {
                explanation: { type: "string", maxLength: 400 },
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
    const explanation = typeof parsed?.explanation === "string" ? parsed.explanation.trim() : "";
    return explanation || null;
  } catch (e) {
    clearTimeout(timer);
    console.error("[chainExplain] OpenAI error:", e?.status, e?.message || e);
    return null;
  }
}

/**
 * Genera la spiegazione per una catena di 3 annunci (in ordine di ciclo:
 * cycleListings[i] viene dato da chi lo possiede e ricevuto da chi
 * possiede cycleListings[(i+2)%3], cioè il precedente nel ciclo).
 * Prova l'AI, ricade sempre sul template deterministico se non disponibile.
 */
export async function explainChain(cycleListings) {
  const fallback = templateChainExplanation(cycleListings);
  if (!client || !Array.isArray(cycleListings) || cycleListings.length !== 3) return fallback;

  const slim = cycleListings.map((l) => ({
    type: l?.type,
    from: l?.route_from ?? l?.location ?? null,
    to: l?.route_to ?? null,
    date: l?.type === "hotel" ? l?.check_in : l?.depart_at,
    price: l?.price ?? null,
  }));

  const prompt = `Scrivi una spiegazione breve e amichevole (massimo 3 frasi, in italiano) di uno scambio a 3 persone tra biglietti/prenotazioni di viaggio.
Il ciclo è: chi possiede l'annuncio 1 lo dà e riceve in cambio l'annuncio 2; chi possiede l'annuncio 2 lo dà e riceve in cambio l'annuncio 3; chi possiede l'annuncio 3 lo dà e riceve in cambio l'annuncio 1.
Non inventare nomi di persone: parla di "annuncio 1/2/3" o descrivi le tratte/città. Chiudi ricordando che serve la conferma di tutti e 3.

Annunci: ${JSON.stringify(slim)}

Rispondi SOLO con: {"explanation": "<testo>"}`;

  const ai = await callOpenAIExplain(prompt, CHAIN_EXPLAIN_TIMEOUT_MS);
  return ai || fallback;
}
