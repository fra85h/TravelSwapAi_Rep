// server/src/models/fbIngest.js
import { supabase } from '../db.js';

/**
 * Inserisce un annuncio in tabella esistente `listings` con un set minimo di colonne
 * già presenti nel tuo progetto: (title, description, type, location, price, status).
 *
 * Se la tabella ha anche colonne opzionali (cerco_vendo, route_from, route_to, depart_at, arrive_at),
 * proviamo ad aggiornarle in un secondo step — se non esistono, ignoriamo l'errore.
 */
export async function upsertListingFromFacebook({ channel, externalId, contactUrl, rawText, parsed }) {
  if (!supabase) throw new Error('Supabase client not configured');

  // Costruisci titolino e location
  const parts = [];
  if (parsed?.cerco_vendo) parts.push(parsed.cerco_vendo);
  if (parsed?.asset_type) parts.push(parsed.asset_type);
  if (parsed?.from_location || parsed?.to_location) {
    const route = [parsed.from_location, parsed.to_location].filter(Boolean).join(' → ');
    if (route) parts.push(route);
  }
  if (parsed?.start_date) parts.push(parsed.start_date);
  const title = parts.join(' · ') || 'Annuncio Facebook';

  const location = parsed?.from_location && parsed?.to_location
    ? `${parsed.from_location} → ${parsed.to_location}`
    : (parsed?.from_location || parsed?.to_location || null);

  const rowMinimal = {
    // colonne presenti sul tuo progetto:
    title,
    description: rawText,
    type: parsed?.asset_type ?? null,
    location,
    price: parsed?.price ?? null,
    status: 'active', // o 'draft' se preferisci
  };

  // 1) Inserimento "sicuro" (solo colonne note)
  const ins =await supabase
  .from('listings')
  .upsert({ ...rowMinimal, source: channel, external_id: externalId }, { onConflict: 'source,external_id' })
  .select('id')
  .single();
  if (ins.error) throw ins.error;
  const listingId = ins.data.id;

  // 2) Aggiornamento best-effort con colonne opzionali (se esistono)
  const optionalPatch = {
    cerco_vendo: parsed?.cerco_vendo ?? null,
    route_from: parsed?.from_location ?? null,
    route_to: parsed?.to_location ?? null,
    depart_at: parsed?.start_date ?? null,
    arrive_at: parsed?.end_date ?? null,
    // contact_url: contactUrl ?? null,   // se esiste la colonna
    // source: channel,                   // se aggiungi colonna per tracciamento
    // external_id: externalId,           // se aggiungi colonna per idempotenza
  };

  try {
    await supabase.from('listings').update(optionalPatch).eq('id', listingId);
  } catch (e) {
    // Se alcune colonne non esistono, PostgREST può rispondere con errore.
    // Non è bloccante: l'inserimento minimale è già andato a buon fine.
    console.warn('[fbIngest] optional update skipped:', e?.message || String(e));
  }

  return { id: listingId };
}
