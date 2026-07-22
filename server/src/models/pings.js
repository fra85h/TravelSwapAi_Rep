// server/src/models/pings.js
// Feature "Ping": chi ha il VENDO che serve a un CERCO lo segnala al
// proprietario del CERCO — niente offerta, niente chat, solo un avviso con
// link diretto. Stesse regole di dominio di offers.js (VENDO/CERCO), ma qui
// non nasce nessuna transazione: solo una notifica.
import { isUUID } from '../util/uuid.js';
import { supabase } from '../db.js';
import { sendExpoPush } from '../lib/push.js';

export async function sendListingPing(fromListingId, toListingId, senderId) {
  if (!isUUID(fromListingId) || !isUUID(toListingId) || !isUUID(senderId)) {
    throw new Error('Invalid ids');
  }
  if (!supabase) throw new Error('Supabase non configurato');

  const { data: from, error: fromErr } = await supabase
    .from('listings')
    .select('id, user_id, title, status, cerco_vendo')
    .eq('id', fromListingId)
    .maybeSingle();
  if (fromErr) throw fromErr;
  if (!from || String(from.user_id) !== String(senderId)) {
    throw new Error('from_listing non è tuo');
  }
  if (from.status !== 'active' || String(from.cerco_vendo || '').toUpperCase() !== 'VENDO') {
    throw new Error('from_listing deve essere un tuo annuncio VENDO attivo');
  }

  const { data: to, error: toErr } = await supabase
    .from('listings')
    .select('id, user_id, title, status, cerco_vendo')
    .eq('id', toListingId)
    .maybeSingle();
  if (toErr) throw toErr;
  if (!to || to.status !== 'active' || String(to.cerco_vendo || '').toUpperCase() !== 'CERCO') {
    throw new Error('to_listing deve essere un annuncio CERCO attivo');
  }
  if (String(to.user_id) === String(senderId)) {
    throw new Error('Non puoi segnalare un tuo annuncio a te stesso');
  }

  const { error: insErr } = await supabase
    .from('listing_pings')
    .insert({ from_listing_id: fromListingId, to_listing_id: toListingId, sender_id: senderId });

  if (insErr) {
    // 23505 = unique_violation: ping già inviato per questa coppia di annunci
    // (anche in caso di doppio click in corsa) — non è un errore per l'utente.
    if (insErr.code === '23505') {
      return { ok: true, alreadySent: true };
    }
    throw insErr;
  }

  try {
    await supabase.from('notifications').insert({
      user_id: to.user_id,
      type: 'listing_ping',
      title: 'Qualcuno ha quello che cerchi',
      body: `«${from.title || ''}» potrebbe fare al caso del tuo annuncio «${to.title || ''}»`,
      data: { fromListingId, toListingId },
    });
    sendExpoPush(to.user_id, {
      title: 'Qualcuno ha quello che cerchi',
      body: `Guarda «${from.title || ''}»`,
      data: { type: 'listing_ping', fromListingId, toListingId },
    });
  } catch (e) {
    console.error('[ping notify]', e?.message || e);
  }

  return { ok: true, alreadySent: false };
}
