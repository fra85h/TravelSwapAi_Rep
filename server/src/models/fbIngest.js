// server/src/models/fbIngest.js
import { supabase } from '../db.js';

const DEFAULT_LISTING_OWNER_ID = process.env.DEFAULT_LISTING_OWNER_ID;

/**
 * Inserisce un annuncio in tabella `listings` assegnandolo a un utente "tecnico"
 * (DEFAULT_LISTING_OWNER_ID) per soddisfare il vincolo NOT NULL su user_id.
 *
 * Se hai colonne opzionali aggiuntive, aggiornale nel secondo step (best-effort).
 */
export async function upsertListingFromFacebook({ channel, externalId, contactUrl, rawText, parsed }) {
  if (!supabase) throw new Error('Supabase client not configured');

  if (!DEFAULT_LISTING_OWNER_ID) {
    throw new Error('Missing DEFAULT_LISTING_OWNER_ID env var');
  }

  // Titolo sintetico
  const parts = [];
  if (parsed?.cerco_vendo) parts.push(parsed.cerco_vendo);
  if (parsed?.asset_type) parts.push(parsed.asset_type);
  if (parsed?.from_location || parsed?.to_location) {
    const route = [parsed.from_location, parsed.to_location].filter(Boolean).join(' → ');
    if (route) parts.push(route);
  }
  if (parsed?.start_date) parts.push(parsed.start_date);
  const title = parts.join(' · ') || 'Annuncio Facebook';

  // Location human friendly
  const location = parsed?.from_location && parsed?.to_location
    ? `${parsed.from_location} → ${parsed.to_location}`
    : (parsed?.from_location || parsed?.to_location || null);

  // 🔹 Inserimento minimo + owner tecnico obbligatorio
  const baseRow = {
    user_id: DEFAULT_LISTING_OWNER_ID,   // <-- soddisfa NOT NULL
    title,
    description: rawText,
    type: parsed?.asset_type ?? null,
    location,
    price: parsed?.price ?? null,
    status: 'active',
    // se la tua tabella ha già queste colonne, puoi valorizzarle qui direttamente
    source: channel ?? null,
    external_id: externalId ?? null,
    contact_url: contactUrl ?? null,
  };

  // Se hai un vincolo unico (source, external_id) puoi usare upsert
  let insertRes = await supabase
    .from('listings')
    .upsert(baseRow, { onConflict: 'source,external_id' })
    .select('id')
    .single();

  if (insertRes.error) {
    throw insertRes.error;
  }

  const listingId = insertRes.data.id;

  // 🔸 Patch opzionale con campi extra, se esistono nella tabella
  const optionalPatch = {
    cerco_vendo: parsed?.cerco_vendo ?? null,
    route_from: parsed?.from_location ?? null,
    route_to: parsed?.to_location ?? null,
    depart_at: parsed?.start_date ?? null,
    arrive_at: parsed?.end_date ?? null,
  };

  try {
    await supabase.from('listings').update(optionalPatch).eq('id', listingId);
  } catch (e) {
    // Se alcune colonne non esistono, ignoriamo l'errore (best-effort)
    console.warn('[fbIngest] optional update skipped:', e?.message || String(e));
  }

  return { id: listingId };
}
