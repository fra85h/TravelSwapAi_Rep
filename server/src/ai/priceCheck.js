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
    "è insufficiente.\n" +
    "Prima di dare il verdetto, ragiona esplicitamente su questi fattori quando la data è nota:\n" +
    "- Hotel: periodo dell'anno e stagionalità della località (alta/media/bassa stagione — es. mare in agosto, " +
    "città d'arte durante fiere/ponti/festività), giorno della settimana (weekend vs feriale). Un prezzo identico " +
    "può essere congruo in alta stagione e alto in bassa stagione: tienine conto nel verdetto, non solo nel testo.\n" +
    "- Treno: classe di viaggio e tipologia/operatore del servizio (es. Frecciarossa/Frecciargento/Italo Alta " +
    "Velocità vs Intercity vs Regionale, 1a vs 2a classe) SE indicati nel titolo o nella descrizione dell'annuncio. " +
    "Questi fattori cambiano enormemente il prezzo tipico di mercato. Se titolo/descrizione non specificano classe " +
    "o tipologia, NON assumere silenziosamente la fascia più economica (Regionale/2a classe): valuta con più " +
    "cautela e segnala esplicitamente nella spiegazione che l'assenza di questi dettagli rende la stima meno precisa.\n" +
    "Rispondi SOLO con JSON valido: " +
    `{ "verdict": "low"|"fair"|"high", "explanation": string } — explanation in ${langName}, max 2 frasi.`
  );
}

const FALLBACK_EXPLANATION = {
  it: "Analisi completata, ma senza una spiegazione dettagliata.",
  en: "Analysis completed, but without a detailed explanation.",
  es: "Análisis completado, pero sin una explicación detallada.",
};

// Tetto di sicurezza sulla descrizione: è testo libero incollato dall'utente
// (a volte l'intera conferma di prenotazione), non va gonfiare il prompt.
const MAX_DESCRIPTION_CHARS = 600;

function describeListing(listing) {
  const { type, location, route_from, route_to, check_in, check_out, depart_at, arrive_at, title, description } = listing || {};
  const base = type === "train"
    ? (() => {
        const route = (route_from && route_to) ? `${route_from} → ${route_to}` : (location || "tratta non specificata");
        return `Biglietto treno ${route}, partenza ${depart_at || "non indicata"}, arrivo ${arrive_at || "non indicato"}.`;
      })()
    : `Soggiorno hotel a ${location || "località non specificata"}, check-in ${check_in || "non indicato"}, check-out ${check_out || "non indicato"}.`;

  // Titolo e descrizione originali dell'annuncio: possono contenere dettagli
  // che le colonne strutturate non hanno (classe/tipologia treno, categoria
  // hotel, stelle, ecc.) — utili al modello per un giudizio più preciso.
  const extra = [];
  if (title) extra.push(`Titolo annuncio: "${title}".`);
  if (description) {
    const d = String(description).trim().slice(0, MAX_DESCRIPTION_CHARS);
    if (d) extra.push(`Descrizione annuncio: "${d}".`);
  }

  return extra.length ? `${base}\n${extra.join("\n")}` : base;
}

/**
 * @param {object} listing - riga della tabella listings (type, price, currency, location, route_from, route_to, check_in, check_out, depart_at, arrive_at, title, description)
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
