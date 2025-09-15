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
- Orari treno: departAt/arriveAt in "YYYY-MM-DD HH:mm". *Il ritorno (returnAt) è opzionale per il treno, se presente usa sempre lo stesso formato.*
- "isNamedTicket" true se biglietto nominativo, false se esplicitamente non nominativo/cedibile; altrimenti null.
- "gender" è "M" o "F" se indicato; altrimenti null.
- "pnr" realistico (5-8 alfanumerici) se presente; altrimenti null.
- "price" numero o stringa numerica; altrimenti null.
- "title": costruiscilo in modo **standard**: "<CERCO/VENDO> <treno/hotel> <Origine> → <Destinazione> <data> <prezzo>".
  • Usa "treno" o "hotel" come etichette.
  • La data per hotel è il check-in, per treno è la data di partenza (YYYY-MM-DD).
  • Includi il simbolo € quando il prezzo è presente.
`;

const EMPTY = {
  cercoVendo: null,
  type: null,
  title: null,
  location: null,
  checkIn: null,
  checkOut: null,
  departAt: null,
  arriveAt: null,
  returnAt: null,
  isNamedTicket: null,
  gender: null,
  pnr: null,
  price: null,
};

function sanitizeParsed(obj) {
  const p = { ...EMPTY, ...(obj || {}) };

  // Se price è numero → stringa
  if (typeof p.price === "number") p.price = String(p.price);

  // Normalizzazione per tipo
  if (p.type === "hotel") {
    // per hotel ignoriamo i campi del treno
    p.departAt = "";
    p.arriveAt = "";
    p.returnAt = undefined; // non mandato alla app/salvataggio
    p.isNamedTicket = false;
    p.gender = "";
  }
  if (p.type === "train") {
    // per treno ignoriamo i campi dell'hotel
    p.checkIn = "";
    p.checkOut = "";
  }

  // Null → stringa vuota per i campi testo usati nel form
  const toStr = ["title","location","checkIn","checkOut","departAt","arriveAt","pnr","price","gender"];
  for (const k of toStr) {
    if (p[k] == null) p[k] = "";
  }

  // Mantieni boolean o null per isNamedTicket
  if (typeof p.isNamedTicket !== "boolean") {
    // se hotel abbiamo già messo false sopra, altrimenti lascia null
    if (p.type !== "hotel") p.isNamedTicket = null;
  }

  return p;
}

function buildStandardTitle(p) {
  const cv = p.cercoVendo || null;          // CERCO | VENDO | null
  const tp = p.type || null;                 // hotel | train | null
  const loc = p.location || null;            // “Origine → Destinazione” o località
  const priceStr = p.price ? `${String(p.price).replace(',', '.')}` : null;

  const pickDate =
    tp === "hotel"
      ? (p.checkIn || null)
      : (p.departAt ? String(p.departAt).split(" ")[0] : null); // YYYY-MM-DD da departAt

  const tag =
    tp === "hotel" ? "hotel" :
    tp === "train" ? "treno" : null;

  if (!cv || !tag || !loc) return null;

  return `${cv} ${tag} ${loc}${pickDate ? ` ${pickDate}` : ""}${priceStr ? ` €${priceStr}` : ""}`.trim();
}

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
          "Lingua: " + locale + "\n" +
          "Testo annuncio:\n\"\"\"" + user + "\"\"\"\n" +
          "Rispondi SOLO con JSON conforme allo schema.",
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
            cercoVendo: { type: ["string", "null"], enum: ["CERCO", "VENDO", null] },
            type: { type: ["string", "null"], enum: ["hotel", "train", null] },
            title: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            checkIn: { type: ["string", "null"], description: "YYYY-MM-DD" },
            checkOut: { type: ["string", "null"], description: "YYYY-MM-DD" },
            departAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm" },
            arriveAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm" },
            returnAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm (opzionale per treno)" },
            isNamedTicket: { type: ["boolean", "null"] },
            gender: { type: ["string", "null"], enum: ["M", "F", null] },
            pnr: { type: ["string", "null"] },
            price: { type: ["string", "null"] },
          },
          required: [
            "cercoVendo",
            "type","title","location","checkIn","checkOut",
            "departAt","arriveAt","returnAt","isNamedTicket","gender","pnr","price"
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
    const raw = JSON.parse(out || "{}") || {};
    // pulizia/normalizzazione
    const p = sanitizeParsed(raw);

    // Titolo: se mancante o troppo corto, costruiscine uno standard
    if (!p.title || String(p.title).trim().length < 8) {
      const std = buildStandardTitle(p);
      if (std) p.title = std;
    }

    // Non esportare returnAt se vuoto/undefined (coerenza con app)
    if (!p.returnAt) delete p.returnAt;

    return p;
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
