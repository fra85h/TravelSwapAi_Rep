// server/src/models/fbIngest.js
import { createClient } from '@supabase/supabase-js';

// 1) prova a riutilizzare il client condiviso come fanno gli altri moduli
let sharedClient = null;
try {
  const mod = await import('../db.js');           // <-- stesso path che usano gli altri
  sharedClient = mod?.supabase ?? null;
} catch {
  // se il modulo non esiste o non esporta, andiamo di fallback sotto
}

// 2) fallback: crea un client locale SOLO se quello condiviso non c'è
function makeFallbackClient() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// 3) client effettivo usato dal model
const supabase = sharedClient ?? makeFallbackClient();

const DEFAULT_LISTING_OWNER_ID = (process.env.DEFAULT_LISTING_OWNER_ID || '').trim();
const SECRETS_TABLE = 'listing_secrets'; // se usi schema privato: 'private.listing_secrets'

/**
 * Inserisce/aggiorna un annuncio in `listings` assegnandolo a un utente tecnico
 * (DEFAULT_LISTING_OWNER_ID) per soddisfare il vincolo NOT NULL su user_id.
 * Dedup su (source, external_id).
 */
export async function upsertListingFromFacebook({
  channel,
  externalId,
  contactUrl,
  rawText,
  parsed,
}) {
  // hard check: qui non deve mai mancare
  if (!supabase) {
    throw new Error(
      '[fbIngest] Supabase client not configured (manca client condiviso e/o SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'
    );
  }
  if (!DEFAULT_LISTING_OWNER_ID) {
    throw new Error('Missing DEFAULT_LISTING_OWNER_ID env var');
  }

  // Titolo sintetico
  const parts = [];
  if (parsed?.cerco_vendo) parts.push(parsed.cerco_vendo);
  if (parsed?.asset_type) parts.push(parsed.asset_type);
  if (parsed?.from_location || parsed?.to_location) {
    const route = [parsed?.from_location, parsed?.to_location].filter(Boolean).join(' → ');
    if (route) parts.push(route);
  }
  if (parsed?.start_date) parts.push(parsed.start_date);
  const title = parts.join(' · ') || 'Annuncio Facebook';

  // Location human-friendly
  const location =
    parsed?.from_location && parsed?.to_location
      ? `${parsed.from_location} → ${parsed.to_location}`
      : parsed?.from_location || parsed?.to_location || null;

  // riga base (allinea i nomi col tuo schema esistente)
  const baseRow = {
    user_id: DEFAULT_LISTING_OWNER_ID, // soddisfa NOT NULL
    title,
    description: rawText,
    type: parsed?.asset_type ?? null,
    location,
    price: parsed?.price ?? null,
    status: 'active',

    // tracing/dedup
    source: channel ?? null,
    external_id: externalId ?? null,
    contact_url: contactUrl ?? null,
  };

  // upsert con dedup su (source, external_id)
  const { data, error } = await supabase
    .from('listings')
    .upsert(baseRow, { onConflict: 'source,external_id' })
    .select('id')
    .single();

  if (error) throw error;

  const listingId = data.id;

  // patch opzionale con campi extra se esistono
  const optionalPatch = {
    cerco_vendo: parsed?.cerco_vendo ?? null,
    route_from: parsed?.from_location ?? null,
    route_to: parsed?.to_location ?? null,
    depart_at: parsed?.start_date ?? null,
    arrive_at: parsed?.end_date ?? null,
  };

  // best-effort: se alcune colonne non esistono, non fallire l’ingest
  const upd = await supabase.from('listings').update(optionalPatch).eq('id', listingId);
  if (upd.error && !/column .* does not exist/i.test(upd.error.message)) {
    // logga ma non bloccare
    console.warn('[fbIngest] optional update warning:', upd.error.message);
  }

  return { id: listingId };
}
