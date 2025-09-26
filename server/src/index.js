// server/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { supabase } from './db.js';
import { trustscoreRouter } from './routes/trustscore.js';
// Routers esistenti
import { listingsRouter } from './routes/listing.js';
import { matchesRouter } from './routes/match.js';

// Parser / ingest / Messenger
import { parseFacebookText } from './parsers/fbParser.js';
import { upsertListingFromFacebook } from './models/fbIngest.js';
import { sendFbText, sendFbQuickReplies } from './lib/fbSend.js'; // quick replies
import { mergeParsed, missingFields, nextPromptFor } from './lib/announceRules.js';
import { getSession, saveSession, clearSession } from './models/fbSessionStore.js';
import { mountParseDescriptionRoute } from './ai/descriptionParse.js';
import { translateListingsRouter } from "./routes/translateListings.js";

const app = express();

// --- CORS ---
app.use(cors({ origin: true, credentials: true }));
const rawBodySaver = (req, _res, buf) => { req.rawBody = buf; };
app.use(express.json({ limit: '2mb', verify: rawBodySaver }));
app.use(express.urlencoded({ extended: false }));
const requireAuth = (req, _res, next) => next();

app.use('/ai', trustscoreRouter);
app.use('/', listingsRouter);
app.use('/api/matches', matchesRouter);
app.use("/", translateListingsRouter);

mountParseDescriptionRoute(app, requireAuth);

// ========== Helpers Messenger (TTL + riepilogo) ==========
const SESSION_TTL_HOURS = 24;

function isSessionExpired(s) {
  if (!s?._ts) return false;
  return (Date.now() - s._ts) > SESSION_TTL_HOURS * 3600 * 1000;
}
async function saveSessionWithTtl(senderId, data) {
  await saveSession(senderId, { ...data, _ts: Date.now() });
}
function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toISOString().slice(0,10); // YYYY-MM-DD
  } catch { return String(d); }
}
function normalizeSession(s) {
  if (!s) return s;
  const out = { ...s };
  // alias tipo
  if (!out.asset_type && out.type) out.asset_type = out.type;
  // normalizza IT→EN
  const t = String(out.asset_type || '').toLowerCase();
  if (t === 'treno') out.asset_type = 'train';
  if (t === 'albergo') out.asset_type = 'hotel';
  // normalizza numeri prezzo tipo "45€"
  if (out.price != null) {
    const n = Number(String(out.price).replace(',', '.').replace(/[^\d.]/g, ''));
    if (Number.isFinite(n)) out.price = n;
  }
  return out;
}

function summaryText(s) {
  const az = s?.cerco_vendo ?? '—';
  const tp = s?.asset_type ?? '—';
  const dep = fmtDate(s?.depart_at ?? s?.check_in);
  const arr = fmtDate(s?.arrive_at ?? s?.check_out);
  const pr = (s?.price != null) ? `${s.price} €` : '—';
  return (
    "🧾 *Riepilogo annuncio*\n" +
    `• Azione: ${az}\n` +
    `• Tipo: ${tp}\n` +
    `• Partenza/Check-in: ${dep}\n` +
    `• Arrivo/Check-out: ${arr}\n` +
    `• Prezzo: ${pr}`
  );
}
// =========================================================

// --- Healthcheck / Debug ---
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/debug/env', (_req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    FB_VERIFY_TOKEN: (process.env.FB_VERIFY_TOKEN || '').trim().slice(0,6) + '...',
    FB_APP_SECRET: process.env.FB_APP_SECRET ? 'SET' : 'MISSING'
  });
});
app.get('/debug/supabase', async (_req, res) => {
  const urlSet = !!(process.env.SUPABASE_URL || '').trim();
  const keySet = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabase) {
    return res.status(200).json({
      NODE_ENV: process.env.NODE_ENV,
      supabase_url_set: urlSet,
      supabase_key_set: keySet,
      client_inited: false,
      ok: false,
      note: 'Supabase client non inizializzato (controlla SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY su Render)'
    });
  }
  try {
    const { data, error } = await supabase.from('listings').select('id').limit(1);
    if (error) {
      return res.status(200).json({
        NODE_ENV: process.env.NODE_ENV,
        supabase_url_set: urlSet,
        supabase_key_set: keySet,
        client_inited: true,
        ok: false,
        supabase_error: error.message
      });
    }
    return res.status(200).json({
      NODE_ENV: process.env.NODE_ENV,
      supabase_url_set: urlSet,
      supabase_key_set: keySet,
      client_inited: true,
      ok: true,
      sample_rows: data?.length ?? 0
    });
  } catch (e) {
    return res.status(200).json({
      NODE_ENV: process.env.NODE_ENV,
      supabase_url_set: urlSet,
      supabase_key_set: keySet,
      client_inited: true,
      ok: false,
      exception: String(e?.message || e)
    });
  }
});
app.get('/dev/ping', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || null });
});

// --- Mini-logger in dev ---
const isDev = process.env.NODE_ENV === 'development';
if (isDev) {
  app.use((req, _res, next) => {
    console.log('[DEV]', req.method, req.path);
    next();
  });
  app.get('/dev/token-check', (_req, res) => {
    const t = (process.env.FB_VERIFY_TOKEN || '').trim();
    res.json({
      env: process.env.NODE_ENV,
      token_length: t.length,
      token_head: t.slice(0, 2),
      token_tail: t.slice(-2)
    });
  });
}

// --- Routers esistenti ---
app.use('/api/listings', listingsRouter);
app.use('/api/matches', matchesRouter);

// --- Firma FB ---
const FB_VERIFY_TOKEN = (process.env.FB_VERIFY_TOKEN || '').trim();
const FB_APP_SECRET  = (process.env.FB_APP_SECRET  || '').trim();
function verifyFacebookSignature(req) {
  try {
    const signature = req.get('X-Hub-Signature-256');
    if (!signature || !signature.startsWith('sha256=')) return false;
    const expected = crypto
      .createHmac('sha256', FB_APP_SECRET || '')
      .update(req.rawBody || Buffer.from(''))
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature.slice(7), 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

// --- Webhook verification (GET) ---
app.get('/webhooks/facebook', (req, res) => {
  const mode = (req.query['hub.mode'] || '').trim();
  const tokenFromQuery = (req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'];
  const serverToken = (process.env.FB_VERIFY_TOKEN || '').trim();
  console.log('[VERIFY] mode=%s qlen=%d slen=%d', mode, tokenFromQuery.length, serverToken.length);
  if (mode === 'subscribe' && tokenFromQuery === serverToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Webhook receiver (POST) ---
app.post('/webhooks/facebook', async (req, res) => {
  const allow = process.env.ALLOW_UNVERIFIED_WEBHOOK === 'true';
  if (!allow && !isDev && !verifyFacebookSignature(req)) {
    return res.sendStatus(403);
  }

  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);

  try {
    for (const entry of body.entry || []) {
      // 1) FEED: post/commenti — (lasciato com'è, con fallback + log)
      if (Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if (change.field !== 'feed') continue;

          console.log('[FB FEED RAW]', JSON.stringify(change, null, 2));
          const v = change.value || {};
          const attachments = Array.isArray(v.attachments?.data) ? v.attachments.data : [];
          const firstAtt = attachments[0] || {};
          const text =
            v.message ||
            v.comment_message ||
            v.description ||
            v.story ||
            firstAtt.description ||
            firstAtt.title ||
            '';
          const externalId =
            v.comment_id ||
            v.post_id ||
            v.video_id ||
            v.photo_id ||
            change.id ||
            `${entry.id}:${Date.now()}`;
          const contactUrl = v.permalink_url || null;

          if (!text?.trim()) {
            console.log('[FB FEED] Nessun testo utile, skip insert. ids=', { externalId, contactUrl });
            continue;
          }
          try {
            const parsed = await parseFacebookText({ text, hint: 'facebook:feed' });
            const result = await upsertListingFromFacebook({
              channel: 'facebook:feed',
              externalId: String(externalId),
              contactUrl,
              rawText: text,
              parsed,
            });
            console.log('[FB FEED] Inserito listing id=', result?.id, 'extId=', externalId);
          } catch (e) {
            console.error('[FB FEED] Error during ingest:', e);
          }
        }
      }

      // 2) MESSENGER — FLOW GUIDATO + POSTBACK + QUICK REPLIES
      if (Array.isArray(entry.messaging)) {
        for (const m of entry.messaging) {
          const senderId = m.sender?.id;

          // --- 2a) POSTBACK (Get Started + menu + Conferma/Modifica) ---
          if (m.postback && m.postback.payload) {
            const p = m.postback.payload;
            try {
              if (p === 'GET_STARTED' || p === 'MENU_PUBBLICA') {
                await clearSession(senderId);
                await sendFbText(
                  senderId,
                  "👋 Ciao e benvenuto su TravelSwap! Per pubblicare un annuncio mi servono:\n" +
                  "• CERCO o VENDO\n• Treno o Hotel\n• Date (partenza/arrivo oppure check-in/check-out)\n• Prezzo in €\n\n" +
                  "Scrivimi pure i dati e ti guiderò passo passo 😉"
                );
                // proponi tipo + azione
                await sendFbQuickReplies(senderId, "È per treno o hotel?", [
                  { title: "🚆 Treno", payload: "TYPE_TRENO" },
                  { title: "🏨 Hotel", payload: "TYPE_HOTEL" }
                ]);
                await sendFbQuickReplies(senderId, "Partiamo: stai CERCANDO o VENDENDO?", [
                  { title: "CERCO", payload: "CV_CERCO" },
                  { title: "VENDO", payload: "CV_VENDO" }
                ]);
              } else if (p === 'MENU_RIEPILOGO') {
                const prev = await getSession(senderId);
                await sendFbText(senderId, "🧾 Riepilogo provvisorio:\n" +
                  `• Azione: ${prev?.cerco_vendo ?? '—'}\n` +
                  `• Tipo: ${prev?.asset_type ?? '—'}\n` +
                  `• Partenza: ${prev?.depart_at ?? prev?.check_in ?? '—'}\n` +
                  `• Arrivo: ${prev?.arrive_at ?? prev?.check_out ?? '—'}\n` +
                  `• Prezzo: ${prev?.price ?? '—'}`
                );
              } else if (p === 'MENU_ANNULLA') {
                await clearSession(senderId);
                await sendFbText(senderId, "❌ Ho annullato la compilazione. Quando vuoi ricominciare, scrivi pure “ciao”.");
              }
              // 🔹 Nuovi postback: Conferma/Modifica pubblicazione
              else if (p === 'PUB_CONFERMA') {
                let s = await getSession(senderId);
                if (!s || isSessionExpired(s)) {
                  await clearSession(senderId);
                  await sendFbText(senderId, "⚠️ Sessione scaduta. Ricominciamo! Scrivi pure i dati dell'annuncio 😉");
                  await sendFbQuickReplies(senderId, "Se vuoi, scegli da cosa partiamo:", [
                    { title: "CERCO", payload: "CV_CERCO" },
                    { title: "VENDO", payload: "CV_VENDO" }
                  ]);
                  return;
                }
                try {
                  const result = await upsertListingFromFacebook({
                    channel: 'facebook:messenger',
                    externalId: m?.mid || `${senderId}:${m.timestamp}`,
                    contactUrl: null,
                    rawText: '', // opzionale
                    parsed: {
                      ...s,
                      start_date: s.check_in || s.depart_at || null,
                      end_date: s.check_out || s.arrive_at || null
                    }
                  });
                  await clearSession(senderId);
                  await sendFbText(
                    senderId,
                    "✅ Fantastico! Il tuo annuncio è stato pubblicato con successo su TravelSwap 🎉\n" +
                    "Grazie per aver condiviso — buona fortuna con lo scambio! ✈️🏨🚆"
                  );
                } catch (e) {
                  console.error('[Messenger Confirm Publish] Error:', e);
                  await sendFbText(senderId, "⚠️ C'è stato un problema nella pubblicazione. Riprova tra poco.");
                }
                return;
              } else if (p === 'PUB_MODIFICA') {
                await sendFbText(senderId,
                  "✏️ Nessun problema! Dimmi cosa vuoi correggere: azione (CERCO/VENDO), tipo (treno/hotel), date o prezzo."
                );
                const s = await getSession(senderId);
                if (!s?.asset_type) {
                  await sendFbQuickReplies(senderId, "È per treno o hotel?", [
                    { title: "🚆 Treno", payload: "TYPE_TRENO" },
                    { title: "🏨 Hotel", payload: "TYPE_HOTEL" }
                  ]);
                }
                return;
              }
            } catch (e) {
              console.error('[Messenger Postback] Error:', e);
              await sendFbText(senderId, 'Ops, si è verificato un errore. Riprova tra poco.');
            }
            continue; // passa al prossimo evento
          }

          // --- 2b) QUICK REPLY payload (bottoni) ---
          // --- 2b) QUICK REPLY payload (bottoni) ---
const quickPayload = m.message?.quick_reply?.payload;
if (quickPayload) {
  try {
    // 🔹 1) Gestisci SUBITO Conferma / Modifica (sono quick replies)
   if (quickPayload === 'PUB_CONFERMA') {
  let s = await getSession(senderId);
  if (s && isSessionExpired?.(s)) {
    await clearSession(senderId);
    s = null;
  }
  if (!s) {
    await sendFbText(senderId, "⚠️ Sessione scaduta. Ricominciamo! Scrivimi i dati dell'annuncio 😉");
    await sendFbQuickReplies?.(senderId, "Se vuoi, scegli da cosa partiamo:", [
      { title: "CERCO", payload: "CV_CERCO" },
      { title: "VENDO", payload: "CV_VENDO" }
    ]);
    return;
  }

  // 👇 normalizza alias/valori PRIMA di confermare
  s = normalizeSession(s);

  // 👇 ricontrollo di sicurezza: se manca qualcosa, non inserire
  const miss = missingFields(s);
  if (miss.length > 0) {
    const prompt = nextPromptFor(miss, s.asset_type);
    await sendFbText(senderId, `📌 Mi manca ancora: ${miss.join(', ')}.\n${prompt}`);
    if (!s.asset_type && miss.includes('tipo (treno/hotel)')) {
      await sendFbQuickReplies?.(senderId, "È per treno o hotel?", [
        { title: "🚆 Treno", payload: "TYPE_TRENO" },
        { title: "🏨 Hotel", payload: "TYPE_HOTEL" }
      ]);
    }
    return;
  }

  try {
    const result = await upsertListingFromFacebook({
      channel: 'facebook:messenger',
      externalId: m.message?.mid || `${senderId}:${m.timestamp}`,
      contactUrl: null,
      rawText: '', // opzionale
      parsed: {
        ...s,
        start_date: s.check_in || s.depart_at || null,
        end_date:   s.check_out || s.arrive_at || null
      }
    });
    await clearSession(senderId);
    await sendFbText(
      senderId,
      "✅ Fantastico! Il tuo annuncio è stato pubblicato con successo su TravelSwap 🎉\n" +
      "Grazie per aver condiviso — buona fortuna con lo scambio! ✈️🏨🚆"
    );
  } catch (e) {
    console.error('[Messenger QuickReply CONFIRM] Error:', e);
    await sendFbText(senderId, "⚠️ C'è stato un problema nella pubblicazione. Riprova tra poco.");
  }
  return;
}


    if (quickPayload === 'PUB_MODIFICA') {
      await sendFbText(senderId,
        "✏️ Nessun problema! Dimmi cosa vuoi correggere: azione (CERCO/VENDO), tipo (treno/hotel), date o prezzo."
      );
      const s = await getSession(senderId);
      if (!s?.asset_type) {
        await sendFbQuickReplies?.(senderId, "È per treno o hotel?", [
          { title: "🚆 Treno", payload: "TYPE_TRENO" },
          { title: "🏨 Hotel", payload: "TYPE_HOTEL" }
        ]);
      }
      return;
    }

    // 🔹 2) Gestione normale delle quick replies (CERCO/VENDO, TIPO)
    let prev = await getSession(senderId);
    if (prev && isSessionExpired?.(prev)) {
      await clearSession(senderId);
      prev = null;
    }
    prev = prev || {};

    if (quickPayload === 'CV_CERCO') prev = { ...prev, cerco_vendo: 'CERCO' };
    if (quickPayload === 'CV_VENDO') prev = { ...prev, cerco_vendo: 'VENDO' };
    if (quickPayload === 'TYPE_TRENO') prev = { ...prev, asset_type: 'train' };
    if (quickPayload === 'TYPE_HOTEL') prev = { ...prev, asset_type: 'hotel' };

    // usa la tua save con TTL se l'hai aggiunta, altrimenti saveSession
    if (typeof saveSessionWithTtl === 'function') {
      await saveSessionWithTtl(senderId, prev);
    } else {
      await saveSession(senderId, { ...prev, _ts: Date.now?.() });
    }

    const miss = missingFields(prev);

    if (miss.length > 0) {
      const prompt = nextPromptFor(miss, prev.asset_type);
      await sendFbText(senderId, `📌 Mi manca ancora: ${miss.join(', ')}.\n${prompt}`);
      if (!prev.asset_type && miss.includes('asset_type')) {
        await sendFbQuickReplies?.(senderId, "È per treno o hotel?", [
          { title: "🚆 Treno", payload: "TYPE_TRENO" },
          { title: "🏨 Hotel", payload: "TYPE_HOTEL" }
        ]);
      }
    } else {
      // ✅ completi → riepilogo + quick replies Conferma/Modifica (NON pubblichiamo qui)
      await (typeof saveSessionWithTtl === 'function'
        ? saveSessionWithTtl(senderId, prev)
        : saveSession(senderId, { ...prev, _ts: Date.now?.() })
      );

      await sendFbText(senderId, summaryText(prev));
      await sendFbQuickReplies?.(senderId, "Procedo con la pubblicazione?", [
        { title: "✅ Conferma", payload: "PUB_CONFERMA" },
        { title: "✏️ Modifica", payload: "PUB_MODIFICA" }
      ]);
    }
  } catch (e) {
    console.error('[Messenger QuickReply] Error:', e);
    await sendFbText(senderId, 'Ops, si è verificato un errore. Riprova tra poco.');
  }
  continue;
}


          // --- 2c) MESSAGGIO TESTO normale (flow AI-only + guard-rails) ---
          const message = m.message;
          if (!message || !message.text) continue;

          const text = message.text;
          try {
            // scorciatoie
            let prev = await getSession(senderId);
            if (prev && isSessionExpired(prev)) {
              await clearSession(senderId);
              prev = null;
            }

            const lower = text.trim().toLowerCase();
            if (lower === 'annulla' || lower === 'cancel') {
              await clearSession(senderId);
              await sendFbText(senderId, "✅ Ok, ho azzerato i dati. Scrivimi quando vuoi ripartire.");
              continue;
            }
            if (lower === 'riepilogo') {
              prev = prev || {};
              await sendFbText(senderId, "🧾 Riepilogo provvisorio:\n" +
                `• Azione: ${prev?.cerco_vendo ?? '—'}\n` +
                `• Tipo: ${prev?.asset_type ?? '—'}\n` +
                `• Partenza: ${prev?.depart_at ?? prev?.check_in ?? '—'}\n` +
                `• Arrivo: ${prev?.arrive_at ?? prev?.check_out ?? '—'}\n` +
                `• Prezzo: ${prev?.price ?? '—'}`
              );
              continue;
            }

            const ai = await parseFacebookText({ text, hint: 'facebook:messenger' });
            const merged = mergeParsed(prev, ai);
            const miss = missingFields(merged);

            if (miss.length > 0) {
              await saveSessionWithTtl(senderId, merged);
              const prompt = nextPromptFor(miss, merged.asset_type);
              const isFirstTouch = !prev || Object.keys(prev).length === 0;
              if (isFirstTouch) {
                await sendFbText(
                  senderId,
                  "👋 Ciao e benvenuto su TravelSwap! Per pubblicare un annuncio mi servono:\n" +
                  "• CERCO o VENDO\n• Treno o Hotel\n• Date (partenza/arrivo oppure check-in/check-out)\n• Prezzo in €\n\n" +
                  "Scrivimi pure i dati e ti guiderò passo passo 😉"
                );
                await sendFbQuickReplies(senderId, "Partiamo: stai CERCANDO o VENDENDO?", [
                  { title: "CERCO", payload: "CV_CERCO" },
                  { title: "VENDO", payload: "CV_VENDO" }
                ]);
              } else {
                await sendFbText(
                  senderId,
                  `📌 Ottimo! Mi mancano ancora: ${miss.join(', ')}.\n${prompt}\n\n` +
                  "Non preoccuparti, scrivi pure con calma 😃"
                );
                if (!merged.asset_type && miss.includes('asset_type')) {
                  await sendFbQuickReplies(senderId, "È per treno o hotel?", [
                    { title: "🚆 Treno", payload: "TYPE_TRENO" },
                    { title: "🏨 Hotel", payload: "TYPE_HOTEL" }
                  ]);
                }
              }
              continue;
            }

            // ✅ tutto ok → riepilogo + conferma (non pubblichiamo subito)
            await saveSessionWithTtl(senderId, merged);
            await sendFbText(senderId, summaryText(merged));
            await sendFbQuickReplies(senderId, "Procedo con la pubblicazione?", [
              { title: "✅ Conferma", payload: "PUB_CONFERMA" },
              { title: "✏️ Modifica", payload: "PUB_MODIFICA" }
            ]);
            continue;

          } catch (e) {
            console.error('[Messenger Flow] Error:', e);
            await sendFbText(senderId, 'Ops, si è verificato un errore. Riprova tra poco.');
          }
        }
      }
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error('[FB Webhook] Error', e);
    return res.sendStatus(500);
  }
});

// --- Simulazione Facebook (solo in dev) ---
if (isDev) {
  app.post('/simulate/facebook', async (req, res) => {
    try {
      const text = req.body?.message;
      if (!text) {
        return res.status(400).json({ ok: false, error: "Missing field 'message'" });
      }
      const parsed = await parseFacebookText({ text, hint: 'facebook:simulate' });
      const result = await upsertListingFromFacebook({
        channel: 'facebook:simulate',
        externalId: 'sim-' + Date.now(),
        contactUrl: null,
        rawText: text,
        parsed,
      });
      return res.json({ ok: true, parsed, result });
    } catch (e) {
      console.error('[Simulate] Error:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });
}

// --- Start ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('NODE_ENV =', process.env.NODE_ENV);
  console.log(`API listening on :${PORT}`);
});

export default app;
