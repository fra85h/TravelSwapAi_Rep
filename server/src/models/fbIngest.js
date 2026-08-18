// server/src/models/fbIngest.js
import { supabase } from '../db.js';
import { computeFullTrustScore } from '../services/trust/computeTrustScore.js';
import { saveTrustAudit } from '../services/trust/store.js';
import { parseLocalizedNumber } from '../util/number.js';

// NB: lo schema richiede: user_id (not null), type (not null), title (not null), location (not null), price (not null)
const DEFAULT_LISTING_OWNER_ID = (process.env.DEFAULT_LISTING_OWNER_ID || '').trim();

// Sotto questa soglia, un annuncio da Facebook/Instagram (Feed, Messenger o
// Instagram DM) non viene pubblicato. Il flusso guidato di Messenger/Instagram
// (missingFields in announceRules.js, conferma esplicita prima di
// PUB_CONFERMA) garantisce che i CAMPI siano completi e coerenti, ma non dice
// nulla sulla PLAUSIBILITÀ del contenuto (foto non pertinenti, testo poco
// credibile, ecc.): quella è responsabilità del TrustScore, e vale
// indipendentemente da quanto il canale sia "guidato" — un utente può
// confermare via chat un annuncio con contenuto scarso tanto quanto uno
// pubblicato dal Feed. Stessa soglia usata altrove per "annuncio
// confuso/poco affidabile" (vedi INCOHERENT_TYPE in routes/trustscore.js).
// Nome env var storico (era solo per il Feed), non rinominato per non
// rompere una configurazione di produzione esistente.
const FB_FEED_MIN_TRUST_SCORE = Number(process.env.FB_FEED_MIN_TRUST_SCORE ?? 50);
const TRUST_SCORE_GATED_CHANNELS = new Set(['facebook:feed', 'facebook:messenger', 'instagram:messenger']);

// Estratte come funzioni pure (nessun accesso a Supabase/OpenAI) così da
// poter testare la regola "chi viene controllato e con quale soglia" senza
// dover mockare rete/DB — vedi test/fbIngestTrustGate.test.js.
export function shouldGateChannel(channel) {
  return TRUST_SCORE_GATED_CHANNELS.has(channel);
}

export function evaluateTrustGate(scored, threshold = FB_FEED_MIN_TRUST_SCORE) {
  if (scored?.moderationFlagged) return { publishable: false, reason: 'moderation_flagged' };

  // "Non verificato" e "verificato male" sono esiti diversi e vanno trattati
  // diversamente. Prima si confondevano: quando l'AI non rispondeva il
  // punteggio veniva tappato a 55, che è SOPRA questa soglia (50), quindi
  // l'annuncio passava il gate e finiva online marchiato male — il contrario
  // di quello che serve. Ora non c'è nessun punteggio da confrontare: il
  // controllo non è stato eseguito, quindi l'annuncio non va pubblicato
  // adesso; resta in bozza e ci riprova il ritentativo.
  if (scored?.verificationPending || scored?.trustScore == null) {
    return { publishable: false, reason: 'verification_pending' };
  }

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
/**
 * L'errore è "questa riga esiste già" (indice ux_listings_external), oppure
 * qualcos'altro?
 *
 * Il codice 23505 da solo non basta a distinguerlo: lo solleva ANCHE
 * before_insert_listings_block_duplicate, che parla di tutt'altro (due
 * annunci identici dello stesso utente). Scambiare quello per "la riga c'è
 * già" porterebbe a proseguire su una riga che non esiste. Si guarda quindi
 * il nome dell'indice, che PostgREST mette in `message` o in `details`.
 */
function isExternalIdConflict(err) {
  if (!err) return false;
  const codice = String(err.code || "");
  const testo = `${err.message || ""} ${err.details || ""}`.toLowerCase();
  return codice === "23505" && testo.includes("ux_listings_external");
}

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
  // Prezzo assente O non positivo: un annuncio a zero euro non è un prezzo,
  // è un dato che il parser non ha saputo leggere. Fermarsi qui con un
  // messaggio chiaro è meglio che farlo respingere più avanti dal CHECK
  // chk_listings_price_positive con un errore di vincolo grezzo.
  if (pres.price == null || !(Number(pres.price) > 0)) throw new Error('Missing price');
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
  let verificationPending = false;
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

    // Verifica non riuscita: NON è una bocciatura dell'annuncio, è un guasto
    // nostro. Far rifare all'utente tutta la conversazione guidata del bot
    // per un singhiozzo del server è sproporzionato, quindi l'annuncio viene
    // creato lo stesso ma resta in BOZZA (paused, non pubblico) con la data
    // del tentativo fallito: il ritentativo lo riprende e lo pubblica appena
    // l'AI risponde. Nessun contenuto non moderato finisce online nel
    // frattempo, perché in pausa non lo vede nessuno.
    if (!gate.publishable && gate.reason === 'verification_pending') {
      console.warn(`[fbIngest] Verifica non completata su ${channel}: l'annuncio resta in bozza e verrà ripreso dal ritentativo.`, {
        externalId, kind: scored.aiUnavailableKind,
      });
      verificationPending = true;
      trustAuditPayload = null;   // nessun punteggio da registrare: non c'è
    } else if (!gate.publishable) {
      console.log(`[fbIngest] Listing scartato su canale ${channel} (TrustScore basso o contenuto segnalato):`, {
        externalId, trustScore: scored.trustScore, moderationFlagged: scored.moderationFlagged,
      });
      return { id: null, skipped: true, reason: gate.reason, trustScore: scored.trustScore };
    } else {
      trustAuditPayload = scored;
    }
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

  // Pubblicare un annuncio significa scrivere fino a tre tabelle (listings,
  // trust_audit, listing_secrets) e PostgREST non offre transazioni: ogni
  // chiamata fa storia a sé. Prima l'annuncio nasceva già 'active' e gli
  // errori delle due scritture successive venivano solo loggati, quindi un
  // fallimento lasciava online un annuncio incompleto:
  //
  //   - senza trust_audit -> listings.trust_score resta NULL, e
  //     listActiveListings esclude i NULL da qualunque filtro di affidabilità:
  //     annuncio attivo ma invisibile nel feed;
  //   - senza listing_secrets -> nessun PNR, quindi nessun pnr_fingerprint, e
  //     l'annuncio SFUGGE all'indice ux_listings_live_pnr che impedisce a due
  //     persone di rivendere lo stesso biglietto.
  //
  // Ora l'annuncio nasce 'paused' (non pubblico), si completano le scritture
  // collegate e solo alla fine diventa 'active'. Un'interruzione a metà
  // lascia una bozza in pausa, mai un annuncio live a metà.
  //
  // La distinzione fra riga NUOVA e riga GIÀ ESISTENTE serve al redelivery
  // del webhook: se l'annuncio c'è già (stesso source+external_id) è già
  // completo e coerente, e va aggiornato com'era prima — metterlo in pausa
  // per poi riattivarlo lo farebbe sparire e riapparire senza motivo.
  //
  // `isNew` si ricava dalla SCRITTURA, non da una SELECT che la precede, e la
  // differenza conta perché più sotto decide chi ha il diritto di CANCELLARE
  // la riga. Con la lettura prima, due consegne concorrenti dello stesso
  // webhook — Facebook li ripete — leggevano entrambe "non c'è", si
  // dichiaravano entrambe padrone della bozza, e se la seconda inciampava
  // sul segreto il suo rollback portava via l'annuncio che la prima aveva
  // appena pubblicato. Provando a inserire, invece, la riga la possiede solo
  // chi ha vinto l'insert: l'altro riceve un 23505 dall'indice
  // ux_listings_external e sa di essere il secondo.
  //
  // Senza source+external_id non c'è nessuna riga da ritrovare: in un indice
  // unico i NULL sono distinti fra loro, quindi l'insert passa comunque.
  let isNew = true;
  let listingId = null;

  const { data: inserito, error: errInsert } = await supabase
    .from('listings')
    .insert({ ...baseRow, status: 'paused' })
    .select('id')
    .single();

  if (!errInsert) {
    listingId = inserito.id;
  } else if (isExternalIdConflict(errInsert)) {
    // Qualcun altro ce l'ha già messa: la riga è sua, noi la aggiorniamo e
    // basta. Il controllo è sul NOME dell'indice, non sul solo codice 23505:
    // con quello scatterebbe anche before_insert_listings_block_duplicate,
    // che è un'altra cosa (annuncio doppio dello stesso utente) e non va
    // scambiata per "questa riga esiste già".
    isNew = false;
    const { data: aggiornato, error: errUpdate } = await supabase
      .from('listings')
      .update(baseRow)
      .eq('source', baseRow.source)
      .eq('external_id', baseRow.external_id)
      .select('id')
      .single();
    if (errUpdate) throw errUpdate;
    listingId = aggiornato.id;
  } else {
    throw errInsert;
  }

  const data = { id: listingId };

  // Da qui in poi, su un annuncio appena creato, ogni errore va ripulito:
  // la bozza in pausa non deve restare come residuo di un tentativo fallito.
  // Su una riga che NON abbiamo creato noi non si tocca niente: è di un'altra
  // consegna, che magari l'ha già pubblicata.
  const rollbackIfNew = async () => {
    if (!isNew) return;
    const { error: errDel } = await supabase.from('listings').delete().eq('id', data.id);
    if (errDel) console.error('[fbIngest] rollback della bozza fallito:', errDel.message);
  };

  if (trustAuditPayload) {
    try {
      await saveTrustAudit({ userId: resolvedOwnerId, listingId: data.id, payload: trustAuditPayload });
    } catch (e) {
      await rollbackIfNew();
      throw new Error(`saveTrustAudit failed: ${e?.message || e}`);
    }
  }

  // Il PNR è un dato riservato: va nella tabella segregata, mai in `listings`.
  // Un errore qui è quasi sempre il rifiuto dell'indice ux_listings_live_pnr,
  // cioè "questo biglietto è già in vendita da qualcun altro": pubblicare
  // comunque significherebbe far convivere due annunci sullo stesso biglietto.
  if (parsed?.pnr) {
    const { error: errSecret } = await supabase
      .from('listing_secrets')
      .upsert({ listing_id: data.id, pnr: parsed.pnr });
    if (errSecret) {
      await rollbackIfNew();
      throw new Error(`listing_secrets upsert failed: ${errSecret.message}`);
    }
  }

  // Verifica non completata: l'annuncio resta in bozza e viene marcato, così
  // il ritentativo sa quali riprendere. Non diventa pubblico adesso: sarebbe
  // contenuto non verificato NÉ moderato (la moderazione passa dalla stessa
  // chiamata che è appena fallita).
  if (verificationPending) {
    const { error: errPending } = await supabase
      .from('listings')
      .update({ trust_pending_at: new Date().toISOString() })
      .eq('id', data.id);
    if (errPending) {
      await rollbackIfNew();
      throw errPending;
    }
    return { id: data.id, pending: true };
  }

  // Tutto scritto: l'annuncio può diventare pubblico. È qui che scattano il
  // tetto agli annunci attivi e il controllo anti-duplicato (entrambi
  // coprono la transizione paused -> active, vedi 20260726120000).
  if (isNew) {
    const { error: errPublish } = await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', data.id);
    if (errPublish) {
      await rollbackIfNew();
      throw errPublish;
    }
  }

  return { id: data.id };
}
