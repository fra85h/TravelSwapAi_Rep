// server/src/parsers/fbParser.js
import OpenAI from 'openai';

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Regex helpers (deterministici)
const DATE_RE = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
const PRICE_RE = /(?:\b|€)\s*(\d{1,4}(?:[.,]\d{2})?)\s*(?:€|euro)?/i;

function normDate(d, m, y) {
  const year = y.length === 2 ? (Number(y) >= 70 ? '19' + y : '20' + y) : y;
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function findDates(text) {
  const results = [];
  let m;
  while ((m = DATE_RE.exec(text)) !== null) {
    results.push(normDate(m[1], m[2], m[3]));
  }
  if (results.length >= 2) return [results[0], results[1]];
  if (results.length === 1) return [results[0], null];
  return [null, null];
}

function detectCercoVendo(text) {
  const t = text.toLowerCase();
  if (t.includes('vendo') || t.includes('cedo') || t.includes('trasferisco')) return 'VENDO';
  if (t.includes('cerco') || t.includes('compro') || t.includes('acquisto')) return 'CERCO';
  return null;
}

function detectAsset(text) {
  const t = text.toLowerCase();
  if (/(treno|freccia|italo|trenitalia)/.test(t)) return 'train';
  if (/(hotel|camera|bb|b&b|ostello|resort)/.test(t)) return 'hotel';
  if (/(volo|aereo|flight|ryanair|wizz|easyjet)/.test(t)) return 'flight';
  return null;
}

function findLocations(text) {
  const t = text.replace(/\s+/g, ' ');
  const dash = /([A-ZÀ-Ý][a-zà-ÿ'. ]{2,})\s*[-–>\u2192]\s*([A-ZÀ-Ý][a-zà-ÿ'. ]{2,})/;
  const daA = /da\s+([A-ZÀ-Ý][a-zà-ÿ'. ]{2,})\s+a\s+([A-ZÀ-Ý][a-zà-ÿ'. ]{2,})/i;

  let m = t.match(dash);
  if (m) return [m[1].trim(), m[2].trim()];
  m = t.match(daA);
  if (m) return [m[1].trim(), m[2].trim()];
  return [null, null];
}

function findHolder(text) {
  const m =
    text.match(/nominativo[:\s]+([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)+)/i) ||
    text.match(/intestat[oa]\s+a\s+([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)+)/i);
  return m ? m[1] : null;
}

function findPrice(text) {
  const m = text.match(PRICE_RE);
  if (!m) return [null, null];
  const raw = m[1].replace(',', '.');
  const price = Number(raw);
  return [Number.isFinite(price) ? price : null, 'EUR'];
}

// Fallback AI (JSON mode)
async function aiParse(text) {
  if (!client) return null;
  try {
    const sys =
      'Sei un parser. Estrai un JSON con chiavi: ' +
      '{"cerco_vendo":"CERCO|VENDO|null","asset_type":"train|hotel|flight|null","from_location":"string|null","to_location":"string|null","start_date":"YYYY-MM-DD|null","end_date":"YYYY-MM-DD|null","holder_name":"string|null","price":"number|null","currency":"EUR|null"}. ' +
      'Se il dato non è presente, usa null. Non inventare.';
    const user = `Testo:\n"""${text}"""`;

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0,
    });

    const content = resp.choices?.[0]?.message?.content;
    if (!content) return null;
    const json = JSON.parse(content);

    return {
      cerco_vendo: json.cerco_vendo ?? null,
      asset_type: json.asset_type ?? null,
      from_location: json.from_location ?? null,
      to_location: json.to_location ?? null,
      start_date: json.start_date ?? null,
      end_date: json.end_date ?? null,
      holder_name: json.holder_name ?? null,
      price: json.price ?? null,
      currency: json.currency ?? (json.price ? 'EUR' : null),
    };
  } catch (e) {
    console.error('[AI Parse] error', e);
    return null;
  }
}

// Orchestratore: regex → (se serve) AI
export async function parseFacebookText({ text /*, hint*/ }) {
  const base = {
    cerco_vendo: detectCercoVendo(text),
    asset_type: detectAsset(text),
    from_location: null,
    to_location: null,
    start_date: null,
    end_date: null,
    holder_name: findHolder(text),
    price: null,
    currency: null,
  };

  const [fromLoc, toLoc] = findLocations(text);
  base.from_location = fromLoc;
  base.to_location = toLoc;

  const [d1, d2] = findDates(text);
  base.start_date = d1;
  base.end_date = d2;

  const [price, currency] = findPrice(text);
  base.price = price;
  base.currency = currency;

  const missing =
    !base.asset_type ||
    (!base.start_date && !base.end_date) ||
    (!base.from_location && !base.to_location) ||
    base.cerco_vendo == null;

  if (missing) {
    const ai = await aiParse(text);
    if (ai) {
      for (const k of Object.keys(ai)) {
        if (base[k] == null && ai[k] != null) base[k] = ai[k];
      }
    }
  }

  if (base.price != null && !base.currency) base.currency = 'EUR';
  return base;
}
