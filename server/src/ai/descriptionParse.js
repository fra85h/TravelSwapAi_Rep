// server/src/ai/descriptionParse.js
import OpenAI from "openai";

const MODEL = process.env.MATCH_AI_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.MATCH_AI_TEMP ?? 0);

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const SYSTEM_PROMPT = `
Sei un parser che legge descrizioni di annunci (italiano) e restituisce **solo** JSON conforme allo schema.
Regole:
- Se un'informazione non è presente o dubbia, imposta null (mai inventare).
- "cercoVendo" deve essere "CERCO" se l'annuncio indica che l'utente cerca qualcosa, "VENDO" se l'utente offre in vendita. Se non chiaro → null.
- "type" è "hotel" per soggiorni, "train" per biglietti treno.
- Date hotel: checkIn/checkOut in "YYYY-MM-DD".
- Orari treno: departAt/arriveAt in "YYYY-MM-DD HH:mm".
- "isNamedTicket" true se biglietto nominativo, false se esplicitamente non nominativo/cedibile; altrimenti null.
- "gender" è "M" o "F" se indicato; altrimenti null.
- "pnr" realistico (5-8 alfanumerici) se presente; altrimenti null.
- "price" numero o stringa numerica; altrimenti null.
- "title": per treni "Origine → Destinazione"; per hotel "Soggiorno a <località>".
- "location": per treni "Origine → Destinazione"; per hotel località.
`;

const EMPTY = {
  type: null, title: null, location: null,
  checkIn: null, checkOut: null,
  departAt: null, arriveAt: null,
  isNamedTicket: null, gender: null, pnr: null, price: null,
};

export async function parseDescriptionWithAI(text, locale = "it") {
  if (!client) throw new Error("OPENAI_API_KEY non configurata sul server");

  const user = String(text ?? "").trim();
  if (!user) return { ...EMPTY };

  const resp = await client.responses.create({
    model: MODEL,
    temperature: TEMPERATURE,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Lingua: ${locale}\n` +
          `Testo annuncio:\n"""${user}"""\n` +
          `Rispondi SOLO con JSON conforme allo schema.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ParsedListing",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: ["string", "null"], enum: ["hotel", "train", null] },
            title: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            checkIn: { type: ["string", "null"], description: "YYYY-MM-DD" },
            checkOut: { type: ["string", "null"], description: "YYYY-MM-DD" },
            departAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm" },
            arriveAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm" },
            isNamedTicket: { type: ["boolean", "null"] },
            gender: { type: ["string", "null"], enum: ["M", "F", null] },
            pnr: { type: ["string", "null"] },
            price: { type: ["string", "null"] },
          },
          required: [
            "type","title","location","checkIn","checkOut",
            "departAt","arriveAt","isNamedTicket","gender","pnr","price"
          ],
        },
      },
    },
  });

  const out =
    resp?.output_text ||
    resp?.output?.[0]?.content?.[0]?.text ||
    resp?.choices?.[0]?.message?.content ||
    "";

  try {
    const parsed = JSON.parse(out || "{}");
    if (parsed && typeof parsed.price === "number") parsed.price = String(parsed.price);
    return {
      type: parsed?.type ?? null,
      title: parsed?.title ?? null,
      location: parsed?.location ?? null,
      checkIn: parsed?.checkIn ?? null,
      checkOut: parsed?.checkOut ?? null,
      departAt: parsed?.departAt ?? null,
      arriveAt: parsed?.arriveAt ?? null,
      isNamedTicket: typeof parsed?.isNamedTicket === "boolean" ? parsed.isNamedTicket : null,
      gender: parsed?.gender ?? null,
      pnr: parsed?.pnr ?? null,
      price: parsed?.price ?? null,
    };
  } catch {
    console.warn("[AI] JSON parse fallita, ritorno EMPTY. Raw:", out);
    return { ...EMPTY };
  }
}













// Route
export function mountParseDescriptionRoute(app, requireAuth) {
  app.post("/ai/parse-description", requireAuth, async (req, res) => {
    console.log("[DEV] POST /ai/parse-description");
    try {
      const { text, locale = "it" } = req.body || {};
      const data = await parseDescriptionWithAI(text, locale);
      return res.json({ ok: true, data });
    } catch (err) {
      console.error("[/ai/parse-description] error:", err);
      // invece di 500 con ok:false, rimandiamo ok:true + EMPTY per non bloccare la UI
      return res.json({ ok: true, data: { ...EMPTY } });
    }
  });
}
