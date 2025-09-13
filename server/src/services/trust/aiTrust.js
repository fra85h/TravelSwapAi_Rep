// server/src/services/trust/aiTrust.js
import { z } from 'zod';

// --- Schema risposta AI ---
const AiResponse = z.object({
  textScore: z.number().min(0).max(100),
  imageScore: z.number().min(0).max(100),
  flags: z.array(z.object({ code: z.string(), msg: z.string() })).default([]),
  suggestedFixes: z.array(z.object({ field: z.string(), suggestion: z.string() })).default([])
});

export async function aiTrustReview(listing, heuristics) {
  // Fallback rapido in dev/senza chiave
  if (!process.env.OPENAI_API_KEY) {
    return {
      textScore: Math.max(55, heuristics.score - 5),   // conservativo
      imageScore: listing.images?.length ? 65 : 40,
      flags: [],
      suggestedFixes: []
    };
  }

  // --- Prompt “controllore” ---
  const system = `
Sei un controllore di annunci marketplace travel. 
Valuta COERENZA testi/date/luoghi/prezzi, INDIZI DI TRUFFA, CHIAREZZA e completezza.
Rispondi SOLO in JSON aderendo allo schema.
Non ripetere il testo utente.
  `.trim();

  const user = {
    role: 'user',
    content: JSON.stringify({
      listing,
      heuristicsPreview: {
        score: heuristics.score,
        flags: heuristics.flags.slice(0, 5) // hint per l’AI, non vincolante
      }
    })
  };

  // ====== ESEMPIO con OpenAI (Responses API JSON) ======
  // Mantieni questa sezione se già usi openai nel progetto.
  // Se utilizzi un provider diverso, sostituisci la “callAi()” restituendo lo stesso formato.
  const json = await callAiJSON(system, user);

  const parsed = AiResponse.safeParse(json);
  if (!parsed.success) {
    // fallback aggressivo se l'AI non rispetta lo schema
    return {
      textScore: Math.max(50, heuristics.score - 10),
      imageScore: listing.images?.length ? 60 : 35,
      flags: [{ code: 'AI_SCHEMA_FALLBACK', msg: 'Risposta AI non conforme allo schema, usato fallback' }],
      suggestedFixes: []
    };
  }
  return parsed.data;
}

// ------------- Provider adapter -------------
async function callAiJSON(systemPrompt, userMsg) {
  // Usa la Responses API con output JSON obbligatorio.
  // NOTE: tieni il pacchetto openai aggiornato nel tuo repo.
  const { OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const resp = await client.responses.create({
    model: process.env.OPENAI_TRUST_MODEL || 'gpt-4.1-mini', // leggero ed economico
    input: [
      { role: 'system', content: systemPrompt },
      userMsg
    ],
    // Forza JSON “structured”
    text_format: {
      type: 'json_schema',
      json_schema: {
        name: 'ai_trustscore_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            textScore: { type: 'number', minimum: 0, maximum: 100 },
            imageScore: { type: 'number', minimum: 0, maximum: 100 },
            flags: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  msg: { type: 'string' }
                },
                required: ['code', 'msg'],
                additionalProperties: false
              }
            },
            suggestedFixes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  suggestion: { type: 'string' }
                },
                required: ['field', 'suggestion'],
                additionalProperties: false
              }
            }
          },
          required: ['textScore', 'imageScore', 'flags', 'suggestedFixes']
        }
      }
    }
  });

  // Estrai il testo JSON
  const out = resp.output[0]?.content[0]?.text || resp.output_text || '{}';
  try {
    return JSON.parse(out);
  } catch {
    return {};
  }
}
