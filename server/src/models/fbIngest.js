// server/src/models/fbIngest.js
import { supabase } from '../db.js';
import { computeFullTrustScore } from '../services/trust/computeTrustScore.js';
import { saveTrustAudit } from '../services/trust/store.js';
import { parseLocalizedNumber } from '../util/number.js';

// NB: lo schema richiede: user_id (not null), type (not null), title (not null), location (not null), price (not null)
const DEFAULT_LISTING_OWNER_ID = (process.env.DEFAULT_LISTING_OWNER_ID || '').trim();

// Sotto questa soglia, un annuncio da Facebook (Feed o Messenger) non viene
// pubblicato. Il flusso guidato di Messenger (missingFields in
// announceRules.js, conferma esplicita prima di PUB_CONFERMA) garantisce che
// i CAMPI siano completi e coerenti, ma non dice nulla sulla PLAUSIBILITÀ del
// contenuto (foto non pertinenti, testo poco credibile, ecc.): quella è
// responsabilità del TrustScore, e vale indipendentemente da quanto il canale
// sia "guidato" — un utente può confermare via Messenger un annuncio con
// contenuto scarso tanto quanto uno pubblicato dal Feed. Stessa soglia usata
// altrove per "annuncio confuso/poco affidabile" (vedi INCOHERENT_TYPE in
// routes/trustscore.js). Nome env var storico (era solo per il Feed), non
// rinominato per non rompere una configurazione di produzione esistente.
const FB_FEED_MIN_TRUST_SCORE = Number(process.env.FB_FEED_MIN_TRUST_SCORE ?? 50);
const TRUST_SCORE_GATED_CHANNELS = new Set(['facebook:feed', 'facebook:messenger']);

// Estratte come funzioni pure (nessun accesso a Supabase/OpenAI) così da
// poter testare la regola "chi viene controllato e con quale soglia" senza
// dover mockare rete/DB — vedi test/fbIngestTrustGate.test.js.
export function shouldGateChannel(channel) {
  return TRUST_SCORE_GATED_CHANNELS.has(channel);
}

export function evaluateTrustGate(scored, threshold = FB_FEED_MIN_TRUST_SCORE) {
  if (scored?.moderationFlagged) return { publishable: false, reason: 'moderation_flagged' };
  if (Number(scored?.trustScore) < threshold) return { publishable: false, reason: 'low_trust_score' };
  return { publishable: true, reason: null };
}

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
  return parseLocalizedNumber(p);
}

function cap(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Normalizza il tipo annuncio: gestisce sia i valori già in inglese (dai
// quick reply del bot, es. "train"/"hotel") sia eventuali sinonimi italiani
// che possono arrivare dal parsing AI del testo libero (es. "treno").
function normType(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'treno' || s === 'train') return 'train';
  if (s === 'hotel' || s === 'albergo') return 'hotel';
  return s || null;
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

export async function upsertListingFromFacebook({ channel, externalId, contactUrl, rawText, parsed, ownerId }) {
  if (!supabase) throw new Error('Supabase client not configured');
  const resolvedOwnerId = ownerId || DEFAULT_LISTING_OWNER_ID;
  if (!resolvedOwnerId) throw new Error('Missing DEFAULT_LISTING_OWNER_ID env var');

  // Costruzione presentazione
  const pres = buildPresentation(parsed);

  // Controlli minimi (dovrebbero essere già garantiti dal flow)
  if (!pres.type) throw new Error('Missing type');
  if (!pres.location || pres.location === '—') throw new Error('Missing location');
  if (pres.price == null) throw new Error('Missing price');
  // CERCO/VENDO ambiguo: prima si assumeva silenziosamente VENDO ("cerco_vendo:
  // pres.az || 'VENDO'"), cioè si dichiarava di avere un biglietto REALE da
  // vendere anche quando l'AI non aveva capito l'intento del testo (es. un
  // commento non pertinente) — un annuncio con la direzione del denaro
  // inventata, pubblicato senza che nessuno l'avesse mai confermata.
  if (!pres.az) throw new Error('Missing cerco_vendo (ambiguous)');

  // Sia il Feed (post/commenti di CHIUNQUE interagisca con la Pagina) sia
  // Messenger (flusso guidato con conferma esplicita, vedi PUB_CONFERMA in
  // index.js) passano dalla stessa pipeline Check AI/TrustScore già
  // obbligatoria per chi pubblica dall'app, invece di andare live senza
  // nessuna verifica di contenuto. Sotto soglia (o contenuto segnalato dalla
  // moderazione): non pubblicare (il chiamante decide se loggare soltanto,
  // come per il Feed, o avvisare l'utente, come fa Messenger in index.js).
  let trustAuditPayload = null;
  if (shouldGateChannel(channel)) {
    const scored = await computeFullTrustScore({
      title: pres.title,
      type: pres.type,
      origin: pres.from,
      destination: pres.to,
      location: pres.location,
      startDate: parsed?.start_date || parsed?.check_in || null,
      endDate: parsed?.end_date || parsed?.check_out || null,
      price: pres.price,
      currency: parsed?.currency || 'EUR',
      images: parsed?.image_url ? [{ url: parsed.image_url }] : [],
    }, 'it');

    const gate = evaluateTrustGate(scored);
    if (!gate.publishable) {
      console.log(`[fbIngest] Listing scartato su canale ${channel} (TrustScore basso o contenuto segnalato):`, {
        externalId, trustScore: scored.trustScore, moderationFlagged: scored.moderationFlagged,
      });
      return { id: null, skipped: true, reason: gate.reason, trustScore: scored.trustScore };
    }
    trustAuditPayload = scored;
  }

  // Mappatura campi sul tuo schema
  const baseRow = {
    user_id: resolvedOwnerId,
    type: pres.type,                         // enum listing_type: 'train' | 'hotel'
    title: pres.title,                       // NOT NULL
    location: pres.location,                 // NOT NULL
    check_in: parsed?.check_in || null,
    check_out: parsed?.check_out || null,
    depart_at: parsed?.depart_at || null,
    arrive_at: parsed?.arrive_at || null,
    is_named_ticket: parsed?.is_named_ticket ?? null,
    gender: parsed?.gender ?? null,
    description: pres.description || rawText || null,  // preferisci descrizione formattata
    price: pres.price,                        // NOT NULL
    image_url: parsed?.image_url || null,
    status: 'active',
    currency: parsed?.currency || 'EUR',
    route_from: pres.from || null,
    route_to: pres.to || null,
    cerco_vendo: pres.az,
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

  if (trustAuditPayload) {
    try {
      await saveTrustAudit({ userId: resolvedOwnerId, listingId: data.id, payload: trustAuditPayload });
    } catch (e) {
      console.error('[fbIngest] saveTrustAudit failed:', e?.message || e);
    }
  }

  // Il PNR è un dato riservato: va nella tabella segregata, mai in `listings`
  if (parsed?.pnr) {
    const { error: errSecret } = await supabase
      .from('listing_secrets')
      .upsert({ listing_id: data.id, pnr: parsed.pnr });
    if (errSecret) {
      console.error('[fbIngest] listing_secrets upsert failed:', errSecret.message);
    }
  }

  return { id: data.id };
}
