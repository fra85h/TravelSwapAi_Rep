// server/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { supabase } from './db.js';

// Routers esistenti
import { listingsRouter } from './routes/listing.js';
import { matchesRouter } from './routes/match.js';

// Parser / ingest / Messenger
import { parseFacebookText } from './parsers/fbParser.js';
import { upsertListingFromFacebook } from './models/fbIngest.js';
import { sendFbText, sendFbQuickReplies } from './lib/fbSend.js'; // ⬅️ aggiunto quick replies
import { mergeParsed, missingFields, nextPromptFor } from './lib/announceRules.js';
import { getSession, saveSession, clearSession } from './models/fbSessionStore.js';

const app = express();

// --- CORS ---
app.use(cors({ origin: true, credentials: true }));

// --- JSON parser con raw body per firma Facebook ---
const rawBodySaver = (req, _res, buf) => { req.rawBody = buf; };
app.use(express.json({ limit: '2mb', verify: rawBodySaver }));
app.use(express.urlencoded({ extended: false }));

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
  console.log("stampo fb");
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
  console.log("stampo fb");
  const allow = process.env.ALLOW_UNVERIFIED_WEBHOOK === 'true';
  if (!allow && !isDev && !verifyFacebookSignature(req)) {
    return res.sendStatus(403);
  }

  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);

  try {
    for (const entry of body.entry || []) {
      console.log("stampo fb");

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

          // --- 2a) POSTBACK (Get Started + menu) ---
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
                 await sendFbQuickReplies(senderId, "È per treno o hotel?", [
      { title: "🚆 Treno", payload: "TYPE_TRENO" },
      { title: "🏨 Hotel", payload: "TYPE_HOTEL" }
    ]);
                // quick replies iniziali
                await sendFbQuickReplies?.(senderId, "Partiamo: stai CERCANDO o VENDENDO?", [
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
            } catch (e) {
              console.error('[Messenger Postback] Error:', e);
              await sendFbText(senderId, 'Ops, si è verificato un errore. Riprova tra poco.');
            }
            continue; // passa al prossimo evento
          }

          // --- 2b) QUICK REPLY payload (bottoni) ---
          const quickPayload = m.message?.quick_reply?.payload;
          if (quickPayload) {
            try {
              let prev = await getSession(senderId) || {};
              if (quickPayload === 'CV_CERCO') prev = { ...prev, cerco_vendo: 'CERCO' };
              if (quickPayload === 'CV_VENDO') prev = { ...prev, cerco_vendo: 'VENDO' };
              if (quickPayload === 'TYPE_TRENO') prev = { ...prev, asset_type: 'train' };
              if (quickPayload === 'TYPE_HOTEL') prev = { ...prev, asset_type: 'hotel' };

              await saveSession(senderId, prev);

              // dopo una scelta, proponi la successiva
              const miss = missingFields(prev);
              if (miss.length > 0) {
                const prompt = nextPromptFor(miss, prev.asset_type);
                // suggerisci le prossime quick replies se serve
                if (!prev.asset_type && (miss.includes('asset_type'))) {
                  await sendFbQuickReplies?.(senderId, "È per treno o hotel?", [
                    { title: "🚆 Treno", payload: "TYPE_TRENO" },
                    { title: "🏨 Hotel", payload: "TYPE_HOTEL" }
                  ]);
                } else {
                  await sendFbText(senderId, `📌 Mi manca ancora: ${miss.join(', ')}.\n${prompt}`);
                }
              } else {
                // tutto presente → pubblica
                const result = await upsertListingFromFacebook({
                  channel: 'facebook:messenger',
                  externalId: m.message?.mid || `${senderId}:${m.timestamp}`,
                  contactUrl: null,
                  rawText: '', // opzionale
                  parsed: {
                    ...prev,
                    start_date: prev.check_in || prev.depart_at || null,
                    end_date: prev.check_out || prev.arrive_at || null
                  }
                });
                await clearSession(senderId);
                await sendFbText(
                  senderId,
                  "✅ Fantastico! Il tuo annuncio è stato pubblicato con successo su TravelSwap 🎉\n\n" +
                  "Grazie per aver condiviso — buona fortuna con lo scambio! ✈️🏨🚆"
                );
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
            const prev = await getSession(senderId);
            // scorciatoie
            const lower = text.trim().toLowerCase();
            if (lower === 'annulla' || lower === 'cancel') {
              await clearSession(senderId);
              await sendFbText(senderId, "✅ Ok, ho azzerato i dati. Scrivimi quando vuoi ripartire.");
              continue;
            }
            if (lower === 'riepilogo') {
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
              await saveSession(senderId, merged);
              const prompt = nextPromptFor(miss, merged.asset_type);
              const isFirstTouch = !prev || Object.keys(prev).length === 0;
              if (isFirstTouch) {
                await sendFbText(
                  senderId,
                  "👋 Ciao e benvenuto su TravelSwap! Per pubblicare un annuncio mi servono:\n" +
                  "• CERCO o VENDO\n• Treno o Hotel\n• Date (partenza/arrivo oppure check-in/check-out)\n• Prezzo in €\n\n" +
                  "Scrivimi pure i dati e ti guiderò passo passo 😉"
                );
                await sendFbQuickReplies?.(senderId, "Partiamo: stai CERCANDO o VENDENDO?", [
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
                  await sendFbQuickReplies?.(senderId, "È per treno o hotel?", [
                    { title: "🚆 Treno", payload: "TYPE_TRENO" },
                    { title: "🏨 Hotel", payload: "TYPE_HOTEL" }
                  ]);
                }
              }
              continue;
            }

            // tutto ok → pubblica
            const result = await upsertListingFromFacebook({
              channel: 'facebook:messenger',
              externalId: message.mid || `${senderId}:${m.timestamp}`,
              contactUrl: null,
              rawText: text,
              parsed: {
                ...merged,
                start_date: merged.check_in || merged.depart_at || null,
                end_date: merged.check_out || merged.arrive_at || null
              }
            });
            await clearSession(senderId);
            await sendFbText(
              senderId,
              "✅ Fantastico! Il tuo annuncio è stato pubblicato con successo su TravelSwap 🎉\n\n" +
              "Grazie per aver condiviso — buona fortuna con lo scambio! ✈️🏨🚆"
            );
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
