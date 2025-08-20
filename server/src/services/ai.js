import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * Chiede al modello uno scoring 0–100 per ciascun listing.
 * Se non c’è API key o il modello fallisce → ritorna null (così usiamo fallback).
 */
export async function scoreWithAI(user, listings) {
  if (!client) return null;

  const system = `Sei un motore di matching. Valuta da 0 a 100 la compatibilità
tra l'utente e ciascun listing. Considera: preferenze, storico, location,
budget/prezzo, categorie e coerenza temporale. Indica anche se la compatibilità
è "bidirezionale" (true/false) in base alla probabilità che l'altro lato sia interessato.
Rispondi SOLO JSON valido con questa forma:
[
  {"id":"<ID listing>","score":<0-100>,"bidirectional":true|false},
  ...
]`;

  const userMsg = {
    role: "user",
    content:
      "Utente: " + JSON.stringify(user) + "\n" +
      "Listings: " + JSON.stringify(listings.map(l => ({
        id: l.id, title: l.title, location: l.location, type: l.type, price: l.price ?? null, description: l.description ?? null
      }))),
  };

  try {
    // modello economico, temperature bassa per stabilità
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [{ role: "system", content: system }, userMsg],
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      return null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
