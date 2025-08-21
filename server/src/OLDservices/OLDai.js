// server/src/ai.js
import OpenAI from 'openai';

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function scoreWithAI(user, listings) {
  if (!client) return null;

  const prompt = `
Sei un motore di matching. Per ogni listing valuta compatibilità con l'utente da 0 a 100 e se il match sembra bidirezionale.
Rispondi SOLO con JSON array, senza testo extra:
[
  { "id": "<listing-uuid>", "score": 0-100, "bidirectional": true/false, "reason": "string" }
  ...
]
Utente: ${JSON.stringify(user)}
Listings: ${JSON.stringify(listings.map(l => ({
    id: l.id,
    title: l.title,
    type: l.type,
    location: l.location,
    price: l.price,
    description: l.description
})))}
  `.trim();

  const resp = await client.responses.create({
    model: 'gpt-4.1-mini',
    temperature: 0.2,
    input: prompt,
  });

  const text = resp.output_text || '';
  try {
    const parsed = JSON.parse(text);
    // filtra risultati con id presenti
    const ids = new Set(listings.map(l => l.id));
    return Array.isArray(parsed)
      ? parsed.filter(x => x && ids.has(x.id))
      : null;
  } catch {
    return null;
  }
}
