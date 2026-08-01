// server/src/ai/priceCheck.js — analisi prezzo con AI reale (non una formula
// locale): valuta se il prezzo di un annuncio sembra basso, congruo o alto
// usando la sola conoscenza generale del modello, senza dati di mercato in
// tempo reale — un parere orientativo, non una quotazione garantita.
import { createOpenAIClient } from "../lib/openaiClient.js";

const client = createOpenAIClient();

const MODEL = process.env.OPENAI_PRICE_MODEL || "gpt-4o-mini";

const LOCALE_LANG_NAME = { it: "italiano", en: "English", es: "español" };

function systemPromptFor(locale, hasPurchaseCap) {
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
    "Velocità vs Intercity vs Regionale, 1a vs 2a classe). Questi fattori cambiano enormemente il prezzo tipico " +
    "di mercato. Possono arrivarti da tre fonti, tutte attendibili allo stesso modo perché dichiarate dal " +
    "venditore: i campi strutturati dell'annuncio, le risposte pubbliche che ha dato alle domande dei " +
    "compratori, oppure titolo/descrizione. Se NESSUNA delle tre li specifica, NON assumere silenziosamente " +
    "la fascia più economica (Regionale/2a classe): valuta con più cautela e segnala esplicitamente nella " +
    "spiegazione che l'assenza di questi dettagli rende la stima meno precisa.\n" +
    (hasPurchaseCap
      ? "- Tetto anti-bagarinaggio: ti viene indicato anche il prezzo di acquisto originale dichiarato dal " +
        "venditore. Su questa piattaforma il prezzo di rivendita NON PUÒ MAI superarlo: è un vincolo tecnico " +
        "bloccante lato server, non un consiglio. Se stimi che il valore di mercato sia superiore al prezzo di " +
        "acquisto, NON suggerire nella spiegazione un prezzo più alto di quello: dai comunque il verdetto sul " +
        "prezzo RICHIESTO, ma se ha senso menzionalo esplicitamente (es. \"sul mercato varrebbe di più, ma qui " +
        "il tetto è il prezzo di acquisto\") invece di lasciar intendere che si possa chiedere di più.\n"
      : "") +
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
  const { type, location, route_from, route_to, check_in, check_out, depart_at, arrive_at, title, description, purchase_price, currency } = listing || {};
  const base = type === "train"
    ? (() => {
        const route = (route_from && route_to) ? `${route_from} → ${route_to}` : (location || "tratta non specificata");
        return `Biglietto treno ${route}, partenza ${depart_at || "non indicata"}, arrivo ${arrive_at || "non indicato"}.`;
      })()
    : `Soggiorno hotel a ${location || "località non specificata"}, check-in ${check_in || "non indicato"}, check-out ${check_out || "non indicato"}.`;

  // Operatore e classe: sono i due fattori che il prompt indica come quelli
  // che spostano di più il prezzo, e finora non arrivavano MAI al modello —
  // né dalle colonne (che pure esistono) né dalle risposte pubbliche del
  // venditore alle domande dei compratori, che per la classe sono l'unica
  // fonte esistente. Il chiamante le passa già unite: colonna se c'è,
  // altrimenti la risposta (vedi extractPriceFactsFromAnswers). Restava solo
  // la speranza che l'utente le avesse scritte nel titolo a mano.
  const extra = [];
  if (listing?.operator) extra.push(`Operatore dichiarato dal venditore: ${listing.operator}.`);
  if (listing?.ticket_class) extra.push(`Classe di viaggio dichiarata dal venditore: ${listing.ticket_class}.`);
  if (title) extra.push(`Titolo annuncio: "${title}".`);
  if (description) {
    const d = String(description).trim().slice(0, MAX_DESCRIPTION_CHARS);
    if (d) extra.push(`Descrizione annuncio: "${d}".`);
  }
  const cap = Number(purchase_price);
  if (Number.isFinite(cap) && cap > 0) {
    extra.push(`Prezzo di acquisto originale dichiarato dal venditore: ${cap} ${currency || "EUR"} (tetto massimo di rivendita su questa piattaforma, vincolo tecnico bloccante).`);
  }

  return extra.length ? `${base}\n${extra.join("\n")}` : base;
}

function suggestSystemPromptFor(locale, hasPurchaseCap) {
  const langName = LOCALE_LANG_NAME[locale] || LOCALE_LANG_NAME.it;
  return (
    "Sei un valutatore prezzi per un marketplace dove privati rivendono " +
    "biglietti treno e prenotazioni hotel non più utilizzabili (mercato italiano). Il venditore " +
    "non ha ancora scelto un prezzo: suggerisci TU un valore plausibile in EUR, basato sulla tua " +
    "conoscenza generale dei prezzi tipici in Italia — non hai accesso a dati di mercato in tempo " +
    "reale, quindi resta prudente se l'informazione è insufficiente.\n" +
    "Ragiona sugli stessi fattori di sempre quando la data è nota: stagionalità/giorno della " +
    "settimana per un hotel, classe/tipologia di servizio per un treno. Se questi dettagli non " +
    "compaiono né tra i dati dell'annuncio né in titolo/descrizione, NON assumere silenziosamente " +
    "la fascia più economica: suggerisci un valore prudente e segnala nella spiegazione che " +
    "l'assenza di dettagli rende la stima meno precisa.\n" +
    (hasPurchaseCap
      ? "- Tetto anti-bagarinaggio: ti viene indicato il prezzo di acquisto originale dichiarato dal " +
        "venditore. Su questa piattaforma il prezzo di rivendita NON PUÒ MAI superarlo: è un vincolo " +
        "tecnico bloccante lato server, non un consiglio. Non suggerire mai un prezzo più alto di quel " +
        "tetto, anche se stimi che il valore di mercato sarebbe superiore — in quel caso proponi il " +
        "tetto stesso (o poco sotto) e spiegalo brevemente.\n"
      : "") +
    "Rispondi SOLO con JSON valido: " +
    `{ "suggestedPrice": number, "explanation": string } — explanation in ${langName}, max 2 frasi.`
  );
}

/**
 * Suggerisce un prezzo di partenza per un annuncio ancora in bozza (nessun
 * id: non esiste come riga finché non si pubblica) — a differenza di
 * checkPriceWithAI, che GIUDICA un prezzo già scelto su un annuncio già
 * pubblicato, questa PROPONE un numero da zero.
 *
 * @param {object} draft - stessi campi di "listing" sopra, ma price è ignorato anche se presente
 * @param {string} locale - "it" | "en" | "es"
 * @returns {Promise<{available:true, suggestedPrice:number, explanation:string} | {available:false, reason:string}>}
 */
export async function suggestPriceWithAI(draft, locale = "it") {
  if (!client) {
    return { available: false, reason: "OPENAI_API_KEY non configurata sul server" };
  }

  const context = describeListing(draft);
  const purchaseCap = Number(draft?.purchase_price);
  const hasPurchaseCap = Number.isFinite(purchaseCap) && purchaseCap > 0;
  const user = `${context}\nIl venditore non ha ancora indicato un prezzo: suggerisci tu un valore plausibile per la rivendita.`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      messages: [
        { role: "system", content: suggestSystemPromptFor(locale, hasPurchaseCap) },
        { role: "user", content: user },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const suggestedPrice = Number(parsed.suggestedPrice);
    if (!Number.isFinite(suggestedPrice) || suggestedPrice <= 0) {
      return { available: false, reason: "Suggerimento non valido" };
    }
    const explanation = (typeof parsed.explanation === "string" && parsed.explanation.trim())
      ? parsed.explanation.trim()
      : (FALLBACK_EXPLANATION[locale] || FALLBACK_EXPLANATION.it);

    return { available: true, suggestedPrice: Math.round(suggestedPrice), explanation };
  } catch (e) {
    console.error("[suggestPriceWithAI] error:", e?.message || e);
    return { available: false, reason: "Analisi non riuscita al momento" };
  }
}

/**
 * @param {object} listing - riga della tabella listings (type, price, currency, location, route_from, route_to, check_in, check_out, depart_at, arrive_at, title, description, purchase_price)
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
  const purchaseCap = Number(listing?.purchase_price);
  const hasPurchaseCap = Number.isFinite(purchaseCap) && purchaseCap > 0;
  const user = `${context}\nPrezzo richiesto: ${price} ${currency}.\nÈ un prezzo basso, congruo o alto per questo tipo di viaggio/soggiorno?`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPromptFor(locale, hasPurchaseCap) },
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
