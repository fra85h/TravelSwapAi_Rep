// server/src/services/trust/aiTrust.js
import OpenAI from "openai";

// Bug preesistente corretto: il costruttore di OpenAI lancia un'eccezione
// a livello di modulo se la chiave manca — a import time, prima che il
// controllo esplicito qui sotto (riga ~15) abbia mai la possibilità di
// scattare — facendo cadere l'intero server all'avvio, non solo questa
// funzione. Costruito solo se la chiave è presente, stesso pattern già
// corretto in ai/score.js.
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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
      flags: [{ code: "AI_DISABLED", msg: "Chiave OpenAI mancante sul server (OPENAI_API_KEY non impostata)" }],
      suggestedFixes: [],
    };
  }

  // Prepara contenuti (testo + immagini opzionali)
  const userContent = [];

  userContent.push({
    type: "text",
    text:
      "Sei un sistema di risk analysis per annunci (treni/hotel). " +
      "Oltre a prezzo, coerenza dei dati e pattern tipici da truffa, valuta " +
      "ANCHE se la tratta è geograficamente/logisticamente plausibile per il " +
      "mezzo indicato in `type`: per un annuncio treno, origin/destination " +
      "devono essere collegabili da una rete ferroviaria reale (es. due isole " +
      "minori non collegate da treno sono una tratta impossibile; la Sardegna " +
      "non ha collegamento su rotaia col continente); per un " +
      "annuncio hotel, verifica solo che la città/location sia un luogo reale. " +
      "Se la tratta è impossibile o palesemente insensata, aggiungi un flag " +
      "con code:'IMPLAUSIBLE_ROUTE' e un msg che spiega perché. " +
      "Valuta anche la DURATA del viaggio (depart_at→arrive_at) rispetto alla " +
      "tratta: se è palesemente incompatibile con la distanza reale (es. " +
      "Milano→Roma in 20 minuti, o Torino→Bari in 45 minuti), aggiungi un flag " +
      "con code:'IMPLAUSIBLE_DURATION' e un msg che spiega perché. " +
      "Se sono presenti immagini, valuta se sono COERENTI con un annuncio di " +
      "viaggio di questo tipo (biglietto, stazione, hotel, camera, luogo): " +
      "foto del tutto estranee (cibo, selfie, oggetti non pertinenti) meritano " +
      "un flag con code:'IRRELEVANT_IMAGES' e un msg che dice cosa mostrano. " +
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

  // Accetta sia URL https (foto già caricate) sia data URI base64 (foto
  // ancora locali al momento del Check AI in creazione — prima di questa
  // modifica le foto non venivano MAI viste dall'AI, perché l'upload
  // avviene solo alla pubblicazione).
  const imageUrls = Array.isArray(listing?.images)
    ? listing.images
        .map((i) => (i?.url || i?.uri || "").trim())
        .filter((u) => /^https?:\/\//i.test(u) || /^data:image\//i.test(u))
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
      // temperature 0: massima consistenza tra check ripetuti sullo stesso
      // annuncio (un punteggio di rischio non deve ballare a ogni click).
      temperature: 0,
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
    console.error("[aiTrustReview] error:", e?.status || "", e?.message || e);
    // Motivo compatto per la diagnosi (mostrato solo nella web di test).
    // Lo status HTTP dice quasi tutto: 401 chiave errata, 429 quota/credito,
    // 404/403 modello non abilitato. Nessun segreto: l'SDK non mette mai la
    // chiave nel messaggio d'errore.
    const status = e?.status ? ` (${e.status})` : "";
    const detail = String(e?.message || e || "").slice(0, 160);
    // Fallback: NON far mai fallire l’endpoint
    return {
      textScore: Number.isFinite(heur?.score) ? Number(heur.score) : 55,
      imageScore: imageUrls.length ? 60 : 50,
      flags: [{ code: "AI_ERROR", msg: `Chiamata OpenAI fallita${status}: ${detail}` }],
      suggestedFixes: [],
    };
  }
}
