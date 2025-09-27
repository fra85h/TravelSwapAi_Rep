// server/src/ai/descriptionParse.js
import OpenAI from "openai";

const MODEL = process.env.MATCH_AI_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.MATCH_AI_TEMP ?? 0);

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Oggi (per la regola: primo anno utile nel futuro)
function nowIsoMinutes() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MI = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MI}`;
}

const SYSTEM_PROMPT = `
Sei un parser di annunci di viaggio in italiano. Leggi la descrizione e restituisci SOLO un JSON valido che rispetta esattamente lo schema dato (tutte le chiavi sempre presenti; se un’informazione è assente o dubbia metti null).
Regole vincolanti:

1) Tipo
- "type": "train" per biglietti treno, "hotel" per soggiorni; altrimenti null.
- "cercoVendo": "CERCO" se l’utente cerca, "VENDO" se vende; se non chiaro null.

2) Tratta (sempre Origine-->Destinazione)
- Estrai "origin" e "destination" (includi dettagli di stazione se presenti, es. "Roma Tiburtina").
- "route": costruiscila sempre come "<origin-->destination>" usando ESATTAMENTE l'arrow ASCII "-->" (due trattini + ">"), senza spazi extra attorno ai trattini. Esempio: "Napoli-Afragola-->Roma Tiburtina".
- "location": per i treni deve essere uguale a "route". Per hotel, se non ha senso una tratta, usa la città/località; altrimenti null.

3) Titolo (standardizzato)
- Treni: il "title" deve essere SEMPRE "<CERCO/VENDO> treno <origin-->destination> solo andata".
- Hotel: "title" = "<CERCO/VENDO> hotel <location>".
- Non inserire MAI prezzo o date nel titolo. Se "cercoVendo" è null, usa "Vendo" come default.

4) Date e orari
- Hotel: "checkIn" e "checkOut" in "YYYY-MM-DD".
- Treno: "departAt" e "arriveAt" in "YYYY-MM-DD HH:mm" (24h).
- Se nel testo è indicato solo giorno e mese, determina l’anno come il PRIMO ANNO UTILE NEL FUTURO rispetto a "oggi".
- Se nel testo è indicato anche l’anno ma la data/ora risultante è nel passato rispetto a "oggi", incrementa l’anno di 1 (ripeti finché è nel futuro).
- "Oggi" ti viene passato nel messaggio utente con il formato "YYYY-MM-DD HH:mm".

5) Prezzo
- "price" numero o stringa numerica se presente, altrimenti null.
- NON inserire mai il prezzo nel "title".

6) Altri campi
- "isNamedTicket": true se esplicitamente nominativo/cedibile; false se esplicitamente non nominativo; altrimenti null.
- "gender": "M" o "F" se indicato; altrimenti null.
- "pnr": 5–8 alfanumerici se presente e realistico; altrimenti null.
- "imageUrl": URL se presente; altrimenti null.

7) Formati e pulizia
- Mantieni accenti, maiuscole/minuscole naturali e trattini dei nomi luogo/stazione.
- Rimuovi ripetizioni, spazi doppi ed etichette non necessarie nella "route".
- Restituisci SOLO JSON (nessun testo extra). Nessuna chiave aggiuntiva rispetto allo schema.
`;

// Schema con chiavi estese (origin, destination, route, imageUrl)
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cercoVendo: { type: ["string", "null"], enum: ["CERCO", "VENDO", null] },
    type: { type: ["string", "null"], enum: ["hotel", "train", null] },

    title: { type: ["string", "null"] },

    origin: { type: ["string", "null"] },
    destination: { type: ["string", "null"] },
    route: { type: ["string", "null"] },
    location: { type: ["string", "null"] },

    checkIn: { type: ["string", "null"], description: "YYYY-MM-DD" },
    checkOut: { type: ["string", "null"], description: "YYYY-MM-DD" },

    departAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm" },
    arriveAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm" },
    returnAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm (opzionale per treno)" },

    isNamedTicket: { type: ["boolean", "null"] },
    gender: { type: ["string", "null"], enum: ["M", "F", null] },
    pnr: { type: ["string", "null"] },
    price: { type: ["string", "null", "number"] },

    imageUrl: { type: ["string", "null"] }
  },
  required: [
    "cercoVendo","type","title",
    "origin","destination","route","location",
    "checkIn","checkOut",
    "departAt","arriveAt","returnAt",
    "isNamedTicket","gender","pnr","price",
    "imageUrl"
  ]
};

const EMPTY = {
  cercoVendo: null,
  type: null,
  title: null,

  origin: null,
  destination: null,
  route: null,
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

  imageUrl: null
};

// ---- Helpers di normalizzazione lato server (senza regex di parsing sul testo utente)

function normStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function ensureArrow(route) {
  // forza ASCII "-->" senza spazi attorno ai trattini
  const a = normStr(route);
  if (!a) return null;
  // rimpiazza eventuali frecce unicode o "->" con "-->"
  return a.replace(/\s*[-–—]*>\s*|→|↦|⇒|➔|⟶/g, "-->").replace(/\s*-->\s*/g, "-->");
}

function makeRoute(origin, destination) {
  const a = normStr(origin);
  const b = normStr(destination);
  if (!a && !b) return null;
  if (!b) return a;
  if (!a) return b;
  return `${a}-->${b}`;
}

function ensureFutureYearDateTime(isoYmdHm) {
  // Input "YYYY-MM-DD HH:mm" oppure null
  const s = normStr(isoYmdHm);
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  if (isNaN(d.getTime())) return s; // lascio com'è se non parseabile
  const now = new Date();
  // se è nel passato, bump di anno finché è nel futuro
  while (d.getTime() <= now.getTime()) {
    d.setFullYear(d.getFullYear() + 1);
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MI = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MI}`;
}

function sanitizeParsed(obj) {
  // unisci con EMPTY per garantire tutte le chiavi
  const p = { ...EMPTY, ...(obj || {}) };

  // normalizza stringhe base
  p.cercoVendo = (p.cercoVendo === "CERCO" || p.cercoVendo === "VENDO") ? p.cercoVendo : null;
  p.type = (p.type === "hotel" || p.type === "train") ? p.type : null;

  const origin = normStr(p.origin);
  const destination = normStr(p.destination);

  // route/location coerenti: route sempre "origin-->destination" se possibile
  let route = ensureArrow(p.route) || makeRoute(origin, destination);
  route = ensureArrow(route);

  let location = normStr(p.location);
  if (p.type === "train") {
    location = route || location || null; // per treni location = route
  }
  // pulizia origin/destination
  p.origin = origin;
  p.destination = destination;
  p.route = route;
  p.location = location;

  // prezzo in stringa, MAI nel titolo
  if (typeof p.price === "number") p.price = String(p.price);

  // Rollover futuro per il treno (safety-net, la regola è già nel prompt)
  p.departAt = ensureFutureYearDateTime(p.departAt);
  p.arriveAt = ensureFutureYearDateTime(p.arriveAt);
  p.returnAt = ensureFutureYearDateTime(p.returnAt);

  // Forza titolo secondo specifica
  const action = p.cercoVendo || "VENDO";
  if (p.type === "train" && route) {
    p.title = `${action.charAt(0) + action.slice(1).toLowerCase()} treno ${route} solo andata`;
  } else if (p.type === "hotel" && location) {
    p.title = `${action.charAt(0) + action.slice(1).toLowerCase()} hotel ${location}`;
  } else {
    // fallback minimale senza prezzo
    p.title = normStr(p.title) || (action.charAt(0) + action.slice(1).toLowerCase());
  }

  // Per hotel: azzera campi treno
  if (p.type === "hotel") {
    p.departAt = null;
    p.arriveAt = null;
    p.returnAt = null;
  }
  // Per treno: azzera campi hotel
  if (p.type === "train") {
    p.checkIn = null;
    p.checkOut = null;
  }

  return p;
}

export async function parseDescriptionWithAI(text, locale = "it") {
  if (!client) throw new Error("OPENAI_API_KEY non configurata sul server");

  const user = String(text ?? "").trim();
  if (!user) return { ...EMPTY };

  const today = nowIsoMinutes();

  const resp = await client.responses.create({
    model: MODEL,
    temperature: TEMPERATURE,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Oggi è: ${today}\n` +
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
        schema: JSON_SCHEMA
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
    const clean = sanitizeParsed(raw);
    return clean;
  } catch {
    console.warn("[AI] JSON parse fallita, ritorno EMPTY. Raw:", out);
    return { ...EMPTY };
  }
}

// Route HTTP
export function mountParseDescriptionRoute(app, requireAuth) {
  app.post("/ai/parse-description", requireAuth, async (req, res) => {
    console.log("[DEV] POST /ai/parse-description");
    try {
      const { text, locale = "it" } = req.body || {};
      const data = await parseDescriptionWithAI(text, locale);
      return res.json({ ok: true, data });
    } catch (err) {
      console.error("[/ai/parse-description] error:", err);
      // Per resilienza UI: niente 500; restituisco ok:true + EMPTY
      return res.json({ ok: true, data: { ...EMPTY } });
    }
  });
}
