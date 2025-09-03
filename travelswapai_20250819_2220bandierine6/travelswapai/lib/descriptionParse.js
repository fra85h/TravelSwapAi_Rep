// server/src/ai/descriptionParse.js
import OpenAI from "openai";

/**
 * Modello e temperatura configurabili via env, come score.js
 */
const MODEL = process.env.MATCH_AI_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.MATCH_AI_TEMP ?? 0);

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * JSON schema del risultato che vogliamo dal modello.
 * NB: valori mancanti -> null
 */
const response_format = {
  type: "json_schema",
  json_schema: {
    name: "ParsedListing",
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
        price: { type: ["string", "null"] }
      },
      required: [
        "type","title","location","checkIn","checkOut",
        "departAt","arriveAt","isNamedTicket","gender","pnr","price"
      ]
    },
    strict: true
  }
};

const SYSTEM_PROMPT = `
Sei un parser che legge descrizioni di annunci (italiano) e restituisce **solo** JSON conforme allo schema.
Regole:
- Se un'informazione non è presente o dubbia, imposta null (mai inventare).
- "type" è "hotel" se parliamo di soggiorni, "train" per biglietti treno.
- Date hotel: checkIn/checkOut in "YYYY-MM-DD".
- Orari treno: departAt/arriveAt in "YYYY-MM-DD HH:mm".
- "isNamedTicket" true se biglietto nominativo, false se esplicitamente non nominativo/cedibile; altrimenti null.
- "gender" è "M" o "F" se indicato (solo per biglietti nominativi); altrimenti null.
- "pnr" deve essere realistico (5-8 alfanumerici) se presente; altrimenti null.
- "price" solo numero con punto/virgola o stringa numerica (es: "120" o "120.50"); se non indicato, null.
- "title" sintetico: per treni "Origine → Destinazione"; per hotel "Soggiorno a <località>".
- "location": per treni, "Origine → Destinazione"; per hotel, la località (se nota).
`;

export async function parseDescriptionWithAI(text, locale = "it") {
  if (!client) {
    throw new Error("OPENAI_API_KEY non configurata sul server");
  }
  const user = String(text ?? "").trim();
  if (!user) {
    return {
      type: null, title: null, location: null,
      checkIn: null, checkOut: null,
      departAt: null, arriveAt: null,
      isNamedTicket: null, gender: null, pnr: null, price: null
    };
  }

  const resp = await client.responses.create({
    model: MODEL,
    temperature: TEMPERATURE,
    response_format,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Lingua: ${locale}\n` +
          `Testo annuncio:\n"""${user}"""\n` +
          `Rispondi SOLO con JSON conforme allo schema.`
      }
    ]
  });

  // Estrarre testo
  const out =
    resp?.output_text ??
    resp?.choices?.[0]?.message?.content ??
    (resp?.output?.[0]?.content?.[0]?.text ?? "");

  // Fallback robusto: tenta il parse
  try {
    const parsed = JSON.parse(out);
    // Normalizzazione minima: cast price a stringa se numero
    if (parsed && typeof parsed.price === "number") {
      parsed.price = String(parsed.price);
    }
    return parsed;
  } catch (e) {
    // In casi rari, il client mette già JSON nelle tool outputs:
    try {
      const chunk = resp?.output?.[0]?.content?.find(c => c?.type === "output_text")?.text;
      if (chunk) {
        const parsed2 = JSON.parse(chunk);
        if (typeof parsed2?.price === "number") parsed2.price = String(parsed2.price);
        return parsed2;
      }
    } catch {}
    // Ultimo fallback: tutto null
    return {
      type: null, title: null, location: null,
      checkIn: null, checkOut: null,
      departAt: null, arriveAt: null,
      isNamedTicket: null, gender: null, pnr: null, price: null
    };
  }
}

/**
 * Express handler: POST /ai/parse-description  { text: string, locale?: 'it'|'en'|... }
 */
export function mountParseDescriptionRoute(app, requireAuth) {
  app.post("/ai/parse-description", requireAuth, async (req, res) => {
    try {
      const { text, locale = "it" } = req.body || {};
      const result = await parseDescriptionWithAI(text, locale);
      return res.json({ ok: true, data: result });
    } catch (err) {
      console.error("[/ai/parse-description] error:", err);
      return res.status(500).json({ ok: false, error: "AI_PARSE_FAILED" });
    }
  });
}
