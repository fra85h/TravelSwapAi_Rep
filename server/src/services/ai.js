import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function scoreWithAI(user, listings) {
  if (!client) return null;

  const prompt = `Sei un motore di matching. Valuta (0-100) la compatibilità tra l'utente e ciascun listing. Rispondi JSON:
  [{ "id": "...", "score": 0-100, "bidirectional": true/false }] ...
  Utente: ${JSON.stringify(user)}
  Listings: ${JSON.stringify(listings)}`;

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
    temperature: 0.2,
  });

  const text = resp.output_text || "";
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
