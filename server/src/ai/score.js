// server/src/ai/score.js
import OpenAI from "openai";


const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function scoreWithAI(user, listings) {
  if (!client) return null;
  const prompt = `Sei un motore di matching. Valuta (0-100) la compatibilità tra l'utente e ciascun listing.
Rispondi SOLO JSON array, senza testo extra:
[ { "id": "<uuid>", "score": 0-100, "bidirectional": true/false }, ... ]

Utente: ${JSON.stringify(user)}
Listings: ${JSON.stringify(listings.map(l => ({
  id: l.id, title: l.title, type: l.type, location: l.location, price: l.price, description: l.description
})))} `;

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
    temperature: 0.2,
  });

  const text = resp.output_text || "";
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) return arr;
    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback deterministico se l’AI non risponde:
 * +20 se tipo corrisponde alle preferenze, -penalità se price > maxPrice, +bonus se location matcha
 */
export function heuristicScore(user, listings) {
  const prefs = user?.prefs || {};
  const types = new Set(prefs.types || []);
  const maxPrice = Number(prefs.maxPrice || 1e9);
  const loc = String(prefs.location || "").toLowerCase();

  return (listings || []).map((l) => {
    let s = 60; // base
    if (types.has(l.type)) s += 15;
    if (l.price != null && Number(l.price) <= maxPrice) s += 10;
    if (loc && String(l.location || "").toLowerCase().includes(loc)) s += 10;
    s = Math.max(0, Math.min(99, s));
    return { id: l.id, score: s, bidirectional: s >= 80 };
  });
}
