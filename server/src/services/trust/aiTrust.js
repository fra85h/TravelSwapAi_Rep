// server/src/services/trust/aiTrust.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Valuta un listing con AI e restituisce:
 * - textScore: 0..100
 * - imageScore: 0..100 (50 default se nessuna immagine)
 * - flags: [{ code, msg }]
 * - suggestedFixes: [{ field, suggestion }]
 */
export async function aiTrustReview(listing, heur = {}) {
  // Fallback immediato se manca la chiave
  if (!process.env.OPENAI_API_KEY) {
    return {
      textScore: Number.isFinite(heur?.score) ? Number(heur.score) : 55,
      imageScore: 50,
      flags: [{ code: "AI_DISABLED", msg: "OPENAI_API_KEY non impostata: uso fallback" }],
      suggestedFixes: [],
    };
  }

  // Prepara contenuti (testo + immagini opzionali)
  const userContent = [];

  userContent.push({
    type: "text",
    text:
      "Sei un sistema di risk analysis per annunci (treni/hotel). " +
      "Restituisci SOLO un JSON con la forma: " +
      "{ textScore:number(0-100), imageScore:number(0-100), flags:[{code:string,msg:string}], suggestedFixes:[{field:string,suggestion:string}] } " +
      "Usa rigore: nessun testo extra oltre al JSON.",
  });

  userContent.push({
    type: "text",
    text: `Contesto_heuristics: ${JSON.stringify({
      heurScore: heur?.score ?? null,
      consistency: heur?.consistencyScore ?? null,
      plausibility: heur?.plausibilityScore ?? null,
      completeness: heur?.completenessScore ?? null,
      flags: heur?.flags ?? [],
    })}`,
  });

  userContent.push({
    type: "text",
    text: `Listing: ${JSON.stringify(listing)}`,
  });

  const imageUrls = Array.isArray(listing?.images)
    ? listing.images
        .map((i) => (i?.url || i?.uri || "").trim())
        .filter((u) => /^https?:\/\//i.test(u))
    : [];

  for (const url of imageUrls.slice(0, 4)) {
    userContent.push({
      type: "image_url",
      image_url: { url },
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_TRUST_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" }, // forza JSON
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Sei un analista antifrode. Rispondi sempre e solo con JSON valido secondo il formato richiesto.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // se (per qualche motivo) non è JSON puro, fallback
      parsed = {};
    }

    // Coercizioni + default sicuri
    const clamp01 = (n) => Math.min(100, Math.max(0, Number(n ?? 0)));
    const out = {
      textScore: clamp01(parsed.textScore ?? heur?.score ?? 55),
      imageScore: clamp01(parsed.imageScore ?? (imageUrls.length ? 60 : 50)),
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      suggestedFixes: Array.isArray(parsed.suggestedFixes) ? parsed.suggestedFixes : [],
    };

    return out;
  } catch (e) {
    console.error("[aiTrustReview] error:", e?.message || e);
    // Fallback: NON far mai fallire l’endpoint
    return {
      textScore: Number.isFinite(heur?.score) ? Number(heur.score) : 55,
      imageScore: imageUrls.length ? 60 : 50,
      flags: [{ code: "AI_ERROR", msg: "AI non disponibile o risposta non valida: uso fallback" }],
      suggestedFixes: [],
    };
  }
}
