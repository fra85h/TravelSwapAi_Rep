// server/src/models/fbIngest.js
import { supabase } from '../db.js';

// NB: lo schema richiede: user_id (not null), type (not null), title (not null), location (not null), price (not null)
const DEFAULT_LISTING_OWNER_ID = (process.env.DEFAULT_LISTING_OWNER_ID || '').trim();

function pick(v, fb) {
  // fallback semplice
  return v ?? fb ?? null;
}

function onlyDateStr(d) {
  if (!d) return null;
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0,10);
  } catch { return null; }
}

function priceNumber(p) {
  if (p == null) return null;
  const n = Number(String(p).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cap(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Costruisce titolo / location / descrizione “presentabili” a partire dal parsed.
 * Richiede: cerco_vendo, asset_type, date (train: depart_at/arrive_at; hotel: check_in/check_out), price
 * e per TRAIN: from_location + to_location
 * per HOTEL: hotel_city (oppure location generica -> city)
 */
function buildPresentation(parsed) {
  const az = (parsed?.cerco_vendo || '').toUpperCase(); // CERCO | VENDO

  // 👇 prende sia asset_type che type e normalizza "treno"→train
  const type = normType(parsed?.asset_type ?? parsed?.type);

  const from = parsed?.from_location || parsed?.route_from || null;
  const to   = parsed?.to_location   || parsed?.route_to   || null;
  const city = parsed?.hotel_city || parsed?.location || null;

  const dep = onlyDateStr(parsed?.depart_at || parsed?.start_date || parsed?.check_in);
  const arr = onlyDateStr(parsed?.arrive_at || parsed?.end_date   || parsed?.check_out);

  const price = priceNumber(parsed?.price);

  // Location (not null nello schema)
  let location = null;
  if (type === 'train') {
    if (from && to) location = `${from} → ${to}`;
  } else if (type === 'hotel') {
    if (city) location = city;
  }
  // se ancora nulla, ripiegare su qualcosa sensato (ma idealmente non arriviamo qui)
  if (!location) location = from && to ? `${from} → ${to}` : (city || '—');

  // Titolo
  let titleParts = [];
  titleParts.push(az || 'VENDO'); // default safe
  titleParts.push(type || 'annuncio');

  if (type === 'train') {
    if (from && to) titleParts.push(`${from} → ${to}`);
    if (dep) titleParts.push(dep);
  } else if (type === 'hotel') {
    if (city) titleParts.push(city);
    if (dep && arr) titleParts.push(`${dep} → ${arr}`);
    else if (dep) titleParts.push(dep);
  } else {
    if (dep && arr) titleParts.push(`${dep} → ${arr}`);
    else if (dep) titleParts.push(dep);
  }
  const title = titleParts.filter(Boolean).join(' · ') || 'Annuncio';

  // Descrizione “carina”
  let descLines = [];
  descLines.push(`Azione: ${az || '—'}`);
  descLines.push(`Tipo: ${type || '—'}`);
  if (type === 'train') {
    descLines.push(`Tratta: ${from || '—'} → ${to || '—'}`);
    descLines.push(`Partenza: ${dep || '—'}${arr ? ` · Arrivo: ${arr}` : ''}`);
  } else if (type === 'hotel') {
    descLines.push(`Città/Hotel: ${cap(city) || '—'}`);
    descLines.push(`Check-in: ${dep || '—'}${arr ? ` · Check-out: ${arr}` : ''}`);
  } else {
    descLines.push(`Località: ${location || '—'}`);
    if (dep || arr) descLines.push(`Date: ${dep || '—'}${arr ? ` → ${arr}` : ''}`);
  }
  if (price != null) descLines.push(`Prezzo: ${price.toFixed(2)} €`);

  const description = descLines.join('\n');

  return {
    az, type, from, to, city,
    dep, arr, price,
    title, location, description
  };
}

export async function upsertListingFromFacebook({ channel, externalId, contactUrl, rawText, parsed }) {
  if (!supabase) throw new Error('Supabase client not configured');
  if (!DEFAULT_LISTING_OWNER_ID) throw new Error('Missing DEFAULT_LISTING_OWNER_ID env var');

  // Costruzione presentazione
  const pres = buildPresentation(parsed);

  // Controlli minimi (dovrebbero essere già garantiti dal flow)
  if (!pres.type) throw new Error('Missing type');
  if (!pres.location || pres.location === '—') throw new Error('Missing location');
  if (pres.price == null) throw new Error('Missing price');

  // Mappatura campi sul tuo schema
  const baseRow = {
    user_id: DEFAULT_LISTING_OWNER_ID,
    type: pres.type,                         // enum listing_type: 'train' | 'hotel'
    title: pres.title,                       // NOT NULL
    location: pres.location,                 // NOT NULL
    check_in: parsed?.check_in || null,
    check_out: parsed?.check_out || null,
    depart_at: parsed?.depart_at || null,
    arrive_at: parsed?.arrive_at || null,
    is_named_ticket: parsed?.is_named_ticket ?? null,
    gender: parsed?.gender ?? null,
    pnr: parsed?.pnr ?? null,
    description: pres.description || rawText || null,  // preferisci descrizione formattata
    price: pres.price,                        // NOT NULL
    image_url: parsed?.image_url || null,
    status: 'active',
    currency: parsed?.currency || 'EUR',
    route_from: pres.from || null,
    route_to: pres.to || null,
    cerco_vendo: pres.az || 'VENDO',
    published_at: new Date().toISOString(),
    source: channel ?? null,
    external_id: externalId ?? null,
    contact_url: contactUrl ?? null,
  };

  // upsert su (source, external_id) se hai l'indice univoco
  const { data, error } = await supabase
    .from('listings')
    .upsert(baseRow, { onConflict: 'source,external_id' })
    .select('id')
    .single();

  if (error) throw error;

  return { id: data.id };
}
