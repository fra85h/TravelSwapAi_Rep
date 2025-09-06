// server/src/parsers/fbParser.js
import OpenAI from 'openai';

/**
 * Parser AI-only per testi Facebook (feed + messenger).
 * - Restituisce SEMPRE un oggetto con le chiavi attese.
 * - Se un campo non è trovato, mette null.
 * - L'ingest penserà ai fallback (N/D, 0, default type, ecc.).
 *
 * Richiede: process.env.OPENAI_API_KEY
 */

const client = new OpenAI({
  apiKey: (process.env.OPENAI_API_KEY || '').trim(),
});

// Schema base con tutti i campi a null
function emptyParsed() {
  return {
    asset_type: null,
    cerco_vendo: null,
    from_location: null,
    to_location: null,
    start_date: null,
    end_date: null,
    start_date_time: null,
    end_date_time: null,
    price: null,
    currency: null,
    is_named_ticket: null,
    gender: null,
    pnr: null,
    notes: null,
  };
}

const SYSTEM_PROMPT = `
Sei un estrattore di campi strutturati da testi di annunci (Facebook post/commenti o Messenger).
Devi restituire SOLO JSON, senza testo extra, con le seguenti chiavi:

{
  "asset_type": "train|hotel|...|null",
  "cerco_vendo": "CERCO|VENDO|null",
  "from_location": "Roma|null",
  "to_location": "Milano|null",
  "start_date": "YYYY-MM-DD|null",
  "end_date": "YYYY-MM-DD|null",
  "start_date_time": "YYYY-MM-DDTHH:MM:SSZ|null",
  "end_date_time": "YYYY-MM-DDTHH:MM:SSZ|null",
  "price": 45.00|null,
  "currency": "EUR|€|USD|null",
  "is_named_ticket": true|false|null,
  "gender": "M|F|altro|null",
  "pnr": "string|null",
  "notes": "string|null"
}

Regole:
- NON inventare: se un valore non è deducibile, metti null.
- CERCO/VENDO: se nel testo c’è "vendo"/"vendesi" → VENDO, se "cerco"/"cercasi" → CERCO, altrimenti null.
- asset_type: se vedi "hotel" → hotel, se vedi "treno"/"Italo"/"Freccia" → train, altrimenti null.
- from_location / to_location: estrai tratta (es. "Roma - Milano"), altrimenti null.
- date: converti in YYYY-MM-DD.
- price: numero, con "." come separatore decimale.
- currency: se trovi "€" → EUR.
- is_named_ticket: true se c’è "nominativo"/"non cedibile", altrimenti null.
- notes: info extra non mappate.
`;

// few-shot di esempio
const FEW_SHOTS = [
  {
    user: "Vendo treno Roma - Milano 12/09/2025 nominativo Mario Rossi 45€",
    json: {
      asset_type: "train",
      cerco_vendo: "VENDO",
      from_location: "Roma",
      to_location: "Milano",
      start_date: "2025-09-12",
      end_date: null,
      start_date_time: null,
      end_date_time: null,
      price: 45.00,
      currency: "EUR",
      is_named_ticket: true,
      gender: null,
      pnr: null,
      notes: "Biglietto nominativo"
    }
  },
  {
    user: "Cerco hotel a Firenze dal 20/10 al 22/10, budget 120 euro",
    json: {
      asset_type: "hotel",
      cerco_vendo: "CERCO",
      from_location: "Firenze",
      to_location: null,
      start_date: "2025-10-20",
      end_date: "2025-10-22",
      start_date_time: null,
      end_date_time: null,
      price: 120.00,
      currency: "EUR",
      is_named_ticket: null,
      gender: null,
      pnr: null,
      notes: null
    }
  },
  {
    user: "ciao",
    json: {
      asset_type: null,
      cerco_vendo: null,
      from_location: null,
      to_location: null,
      start_date: null,
      end_date: null,
      start_date_time: null,
      end_date_time: null,
      price: null,
      currency: null,
      is_named_ticket: null,
      gender: null,
      pnr: null,
      notes: null
    }
  }
];

async function aiExtract(text) {
  if (!client.apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  const shotMessages = FEW_SHOTS.flatMap(s => ([
    { role: 'user', content: s.user },
    { role: 'assistant', content: JSON.stringify(s.json) }
  ]));

  const schema = {
    name: "FacebookListingExtraction",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        asset_type: { type: ["string","null"] },
        cerco_vendo: { type: ["string","null"], enum: ["CERCO","VENDO",null] },
        from_location: { type: ["string","null"] },
        to_location: { type: ["string","null"] },
        start_date: { type: ["string","null"] },
        end_date: { type: ["string","null"] },
        start_date_time: { type: ["string","null"] },
        end_date_time: { type: ["string","null"] },
        price: { type: ["number","null"] },
        currency: { type: ["string","null"] },
        is_named_ticket: { type: ["boolean","null"] },
        gender: { type: ["string","null"] },
        pnr: { type: ["string","null"] },
        notes: { type: ["string","null"] }
      },
      required: [
        "asset_type","cerco_vendo","from_location","to_location",
        "start_date","end_date","start_date_time","end_date_time",
        "price","currency","is_named_ticket","gender","pnr","notes"
      ]
    }
  };

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_schema', json_schema: schema },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...shotMessages,
      { role: 'user', content: text }
    ],
  });

  const raw = resp.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(raw);
    // normalizza stringhe vuote → null
    for (const k of Object.keys(parsed)) {
      if (parsed[k] === '') parsed[k] = null;
      if (typeof parsed[k] === 'string') {
        const v = parsed[k].trim();
        parsed[k] = v.length ? v : null;
      }
    }
    if (parsed.cerco_vendo && typeof parsed.cerco_vendo === 'string') {
      const up = parsed.cerco_vendo.toUpperCase();
      parsed.cerco_vendo = (up === 'CERCO' || up === 'VENDO') ? up : null;
    }
    if (parsed.currency && parsed.currency.trim() === '€') {
      parsed.currency = 'EUR';
    }
    return { ok: true, data: { ...emptyParsed(), ...parsed } };
  } catch (e) {
    return { ok: false, error: 'JSON parse error', raw };
  }
}

/**
 * Funzione principale usata da index.js
 */
export async function parseFacebookText({ text, hint }) {
  if (!text || !text.trim()) {
    return emptyParsed();
  }

  try {
    const out = await aiExtract(text.trim());
    if (out.ok) {
      return out.data;
    }
    console.warn('[fbParser] AI returned invalid JSON.', out.error);
    return emptyParsed();
  } catch (err) {
    console.error('[fbParser] OpenAI error:', err?.message || err);
    return emptyParsed();
  }
}

// doppia esportazione: named + default
export default parseFacebookText;
