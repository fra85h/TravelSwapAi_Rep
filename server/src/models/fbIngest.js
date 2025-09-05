// --- in alto tra le config
const DEFAULT_LISTING_TYPE = (process.env.DEFAULT_LISTING_TYPE || 'train').trim();
const DEFAULT_LOCATION     = (process.env.DEFAULT_LOCATION_FALLBACK || 'N/D').trim();
const DEFAULT_PRICE        = Number(process.env.DEFAULT_PRICE_FALLBACK || 0);

// --- helper
function inferType(parsed) {
  const raw = (parsed?.asset_type || '').toLowerCase();
  if (raw.includes('hotel') || raw === 'hotel') return 'hotel';
  if (raw.includes('treno') || raw.includes('train') || raw === 'train') return 'train';
  if (parsed?.from_location || parsed?.to_location) return 'train';
  return DEFAULT_LISTING_TYPE; // <-- SEMPRE un valore valido
}
function buildLocation(parsed) {
  const from = (parsed?.from_location ?? '').trim();
  const to   = (parsed?.to_location   ?? '').trim();
  if (from && to) return `${from} → ${to}`;
  if (from) return from;
  if (to) return to;
  return DEFAULT_LOCATION;      // <-- MAI null
}

export async function upsertListingFromFacebook({ channel, externalId, contactUrl, rawText, parsed }) {
  // ...
  let cercoVendo = (parsed?.cerco_vendo || 'VENDO').toUpperCase();
  if (cercoVendo !== 'CERCO' && cercoVendo !== 'VENDO') cercoVendo = 'VENDO';

  // 👇👇👇 AGGIUNGI QUESTE 3 RIGHE “BLINDO”
  let t = inferType(parsed);
  if (!t) t = DEFAULT_LISTING_TYPE;                     // <-- 1) mai falsy
  let location = buildLocation(parsed) || DEFAULT_LOCATION; // <-- 2) mai falsy
  const price = (typeof parsed?.price === 'number' && parsed.price >= 0) ? parsed.price : DEFAULT_PRICE;

  // log diagnostico (rimuovilo più tardi)
  console.log('[fbIngest] t=%s loc=%s price=%s', t, location, price);

  const titleParts = [cercoVendo, t];
  const from = (parsed?.from_location ?? '').trim();
  const to   = (parsed?.to_location   ?? '').trim();
  if (from || to) titleParts.push([from, to].filter(Boolean).join(' · '));
  if (parsed?.start_date) titleParts.push(parsed.start_date);
  const title = titleParts.join(' · ') || 'Annuncio Facebook';

  const check_in  = t === 'hotel' ? parsed?.start_date ?? null : null;
  const check_out = t === 'hotel' ? parsed?.end_date   ?? null : null;
  const depart_at = t === 'train' ? (parsed?.start_date_time || parsed?.start_date || null) : null;
  const arrive_at = t === 'train' ? (parsed?.end_date_time   || parsed?.end_date   || null) : null;

  const baseRow = {
    user_id: DEFAULT_LISTING_OWNER_ID,
    type: t,                             // <-- NOT NULL
    title,                               // <-- NOT NULL
    location,                            // <-- NOT NULL
    check_in, check_out, depart_at, arrive_at,
    is_named_ticket: parsed?.is_named_ticket ?? null,
    gender: parsed?.gender ?? null,
    pnr: parsed?.pnr ?? null,
    description: rawText ?? null,
    price,                               // <-- NOT NULL
    status: 'active',
    currency: 'EUR',
    route_from: from || null,
    route_to: to   || null,
    cerco_vendo: cercoVendo,
    source: channel ?? null,
    external_id: externalId ?? null,
    contact_url: contactUrl ?? null,
  };

  const { data, error } = await supabase
    .from('listings')
    .upsert(baseRow, { onConflict: 'source,external_id' })
    .select('id')
    .single();

  if (error) throw error;
  return { id: data.id };
}
