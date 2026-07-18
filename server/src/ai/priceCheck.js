// server/src/ai/priceCheck.js — analisi prezzo con AI reale (non una formula
// locale): valuta se il prezzo di un annuncio sembra basso, congruo o alto
// usando la sola conoscenza generale del modello, senza dati di mercato in
// tempo reale — un parere orientativo, non una quotazione garantita.
import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const MODEL = process.env.OPENAI_PRICE_MODEL || "gpt-4o-mini";

const LOCALE_LANG_NAME = { it: "italiano", en: "English", es: "español" };

function systemPromptFor(locale) {
  const langName = LOCALE_LANG_NAME[locale] || LOCALE_LANG_NAME.it;
  return (
    "Sei un valutatore prezzi per un marketplace dove privati rivendono " +
    "biglietti treno e prenotazioni hotel non più utilizzabili (mercato italiano). Dai un parere onesto " +
    "e prudente basato sulla tua conoscenza generale dei prezzi tipici in Italia — " +
    "non hai accesso a dati di mercato in tempo reale, quindi resta cauto se l'informazione " +
    "è insufficiente. Rispondi SOLO con JSON valido: " +
    `{ "verdict": "low"|"fair"|"high", "explanation": string } — explanation in ${langName}, max 2 frasi.`
  );
}

const FALLBACK_EXPLANATION = {
  it: "Analisi completata, ma senza una spiegazione dettagliata.",
  en: "Analysis completed, but without a detailed explanation.",
  es: "Análisis completado, pero sin una explicación detallada.",
};

function describeListing(listing) {
  const { type, location, route_from, route_to, check_in, check_out, depart_at, arrive_at } = listing || {};
  if (type === "train") {
    const route = (route_from && route_to) ? `${route_from} → ${route_to}` : (location || "tratta non specificata");
    return `Biglietto treno ${route}, partenza ${depart_at || "non indicata"}, arrivo ${arrive_at || "non indicato"}.`;
  }
  return `Soggiorno hotel a ${location || "località non specificata"}, check-in ${check_in || "non indicato"}, check-out ${check_out || "non indicato"}.`;
}

/**
 * @param {object} listing - riga della tabella listings (type, price, currency, location, route_from, route_to, check_in, check_out, depart_at, arrive_at)
 * @param {string} locale - "it" | "en" | "es", lingua della spiegazione restituita
 * @returns {Promise<{available:true, verdict:"low"|"fair"|"high", explanation:string} | {available:false, reason:string}>}
 */
export async function checkPriceWithAI(listing, locale = "it") {
  if (!client) {
    return { available: false, reason: "OPENAI_API_KEY non configurata sul server" };
  }

  const price = Number(listing?.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { available: false, reason: "Prezzo mancante o non valido" };
  }

  const context = describeListing(listing);
  const currency = listing?.currency || "EUR";
  const user = `${context}\nPrezzo richiesto: ${price} ${currency}.\nÈ un prezzo basso, congruo o alto per questo tipo di viaggio/soggiorno?`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPromptFor(locale) },
        { role: "user", content: user },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const verdict = ["low", "fair", "high"].includes(parsed.verdict) ? parsed.verdict : "fair";
    const explanation = (typeof parsed.explanation === "string" && parsed.explanation.trim())
      ? parsed.explanation.trim()
      : (FALLBACK_EXPLANATION[locale] || FALLBACK_EXPLANATION.it);

    return { available: true, verdict, explanation };
  } catch (e) {
    console.error("[checkPriceWithAI] error:", e?.message || e);
    return { available: false, reason: "Analisi non riuscita al momento" };
  }
}
