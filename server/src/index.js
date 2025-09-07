// server/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { supabase } from './db.js';
// Routers esistenti (manteniamo compatibilità con il tuo progetto)
import { listingsRouter } from './routes/listing.js';
import { matchesRouter } from './routes/match.js';
// ATTENZIONE: path corretto rispetto a server/src/index.js
import { parseFacebookText } from './parsers/fbParser.js';
import { upsertListingFromFacebook } from './models/fbIngest.js';
import { sendFbText } from './lib/fbSend.js';
import { mergeParsed, missingFields, nextPromptFor } from './lib/announceRules.js';
import { getSession, saveSession, clearSession } from './models/fbSessionStore.js';

const app = express();

// --- CORS ---
app.use(cors({ origin: true, credentials: true }));

// --- JSON parser con raw body per firma Facebook ---
const rawBodySaver = (req, _res, buf) => { req.rawBody = buf; };
app.use(express.json({ limit: '2mb', verify: rawBodySaver }));
app.use(express.urlencoded({ extended: false }));

// --- Healthcheck ---
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/debug/env', (_req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    FB_VERIFY_TOKEN: (process.env.FB_VERIFY_TOKEN || '').trim().slice(0,6) + '...',
    FB_APP_SECRET: process.env.FB_APP_SECRET ? 'SET' : 'MISSING'
  });
});
app.get('/debug/env', (_req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    FB_VERIFY_TOKEN: (process.env.FB_VERIFY_TOKEN || '').trim().slice(0,6) + '...',
    FB_APP_SECRET: process.env.FB_APP_SECRET ? 'SET' : 'MISSING'
  });
});

// --- Debug Supabase (NUOVO) ---
app.get('/debug/supabase', async (_req, res) => {
  const urlSet = !!(process.env.SUPABASE_URL || '').trim();
  const keySet = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  // se il client non è inizializzato, ritorno subito info utili
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

  // prova una query leggera per testare la connessione
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
// --- Ping diagnostico (sempre attivo per debug) ---
app.get('/dev/ping', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || null });
});

// --- Mini-logger in dev per vedere le richieste ---
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

// --- Monta i router esistenti ---
app.use('/api/listings', listingsRouter);
app.use('/api/matches', matchesRouter);

// --- Utils firma FB ---
const FB_VERIFY_TOKEN = (process.env.FB_VERIFY_TOKEN || '').trim();    // CHANGE: trim qui
const FB_APP_SECRET  = (process.env.FB_APP_SECRET  || '').trim();      // CHANGE: trim qui
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
// --- Webhook verification (GET) ---
app.get('/webhooks/facebook', (req, res) => {
  const mode = (req.query['hub.mode'] || '').trim();
  const tokenFromQuery = (req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'];

  const serverToken = (process.env.FB_VERIFY_TOKEN || '').trim();

  // log diagnostico: non stampa il token, solo lunghezze
  console.log('[VERIFY] mode=%s qlen=%d slen=%d', mode, tokenFromQuery.length, serverToken.length);

  if (mode === 'subscribe' && tokenFromQuery === serverToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Webhook receiver (POST) ---

app.post('/webhooks/facebook', async (req, res) => {
  const allow = process.env.ALLOW_UNVERIFIED_WEBHOOK === 'true';
  // in dev potresti voler bypassare per test, ma qui teniamo la verifica attiva
  if (!allow && !isDev && !verifyFacebookSignature(req)) {
    return res.sendStatus(403);
  }
  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);
// 2) Messenger
if (Array.isArray(entry.messaging)) {
  for (const m of entry.messaging) {
    const message = m.message;
    if (!message || !message.text) continue;

    const senderId = m.sender?.id;
    const text = message.text;

    try {
      // 1) stato parziale
      const prev = await getSession(senderId);

      // 2) estrazione AI (riusa il tuo parser AI-only)
      const ai = await parseFacebookText({ text, hint: 'facebook:messenger' });

      // 3) merge
      const merged = mergeParsed(prev, ai);

      // 4) check campi minimi
      const miss = missingFields(merged);
      if (miss.length > 0) {
        await saveSession(senderId, merged);
        const prompt = nextPromptFor(miss, merged.asset_type);
        await sendFbText(senderId, `Mi mancano alcuni dati: ${miss.join(', ')}.\n${prompt}`);
        continue; // ⛔ niente insert
      }

      // 5) tutto ok → pubblica
      const result = await upsertListingFromFacebook({
        channel: 'facebook:messenger',
        externalId: message.mid || `${senderId}:${m.timestamp}`,
        contactUrl: null,
        rawText: text,   // puoi anche salvare l’ultimo testo o tutta la storia se vuoi
        parsed: {
          ...merged,
          // compat per l’ingest (se lo usi internamente)
          start_date: merged.check_in || merged.depart_at || null,
          end_date:   merged.check_out || merged.arrive_at || null,
        },
      });

      // 6) pulizia sessione
      await clearSession(senderId);

      // 7) conferma all’utente
      await sendFbText(senderId, `✅ Annuncio pubblicato su TravelSwap! ID: ${result.id}`);
    } catch (e) {
      console.error('[Messenger Flow] Error:', e);
      await sendFbText(senderId, 'Ops, si è verificato un errore. Riprova tra poco.');
    }
  }
}

  try {
    for (const entry of body.entry || []) {
      // 1) Feed: post/commenti
      if (Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if (change.field === 'feed') {
            const value = change.value || {};
            const text = value.message || value.comment_message || value.description || '';
            const externalId =
              value.comment_id || value.post_id || value.video_id || value.photo_id || change.id || `${entry.id}:${Date.now()}`;
            const contactUrl = value.permalink_url || null;
            if (text?.trim()) {
              const parsed = await parseFacebookText({ text, hint: 'facebook:feed' });
              await upsertListingFromFacebook({
                channel: 'facebook:feed',
                externalId: String(externalId),
                contactUrl,
                rawText: text,
                parsed,
              });
            }
          }
        }
      }
      // 2) Messenger
      if (Array.isArray(entry.messaging)) {
        for (const m of entry.messaging) {
          const message = m.message;
          if (message && message.text) {
            const text = message.text;
            const externalId = message.mid || `${m.sender?.id}:${m.timestamp}`;
            const parsed = await parseFacebookText({ text, hint: 'facebook:messenger' });
            await upsertListingFromFacebook({
              channel: 'facebook:messenger',
              externalId: String(externalId),
              contactUrl: null,
              rawText: text,
              parsed,
            });
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
