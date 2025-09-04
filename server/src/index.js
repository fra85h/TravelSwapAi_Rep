// server/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

// Routers esistenti (manteniamo compatibilità con il tuo progetto)
import { listingsRouter } from './routes/listing.js';
import { matchesRouter } from './routes/match.js';

import { upsertListingFromFacebook } from './models/fbIngest.js';
import { parseFacebookText } from '../parsers/fbParser.js';

const app = express();

// --- CORS ---
app.use(cors({ origin: true, credentials: true }));

// --- JSON parser con raw body per firma Facebook ---
const rawBodySaver = (req, _res, buf) => { req.rawBody = buf; };
app.use(express.json({ limit: '2mb', verify: rawBodySaver }));
app.use(express.urlencoded({ extended: false }));

// --- Healthcheck ---
app.get('/health', (_req, res) => res.json({ ok: true }));

// --- Monta i router esistenti ---
app.use('/api/listings', listingsRouter);
app.use('/api/matches', matchesRouter);

// --- Utils firma FB ---
const { FB_VERIFY_TOKEN, FB_APP_SECRET } = process.env;
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
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Webhook receiver (POST) ---
app.post('/webhooks/facebook', async (req, res) => {
  if (!verifyFacebookSignature(req)) {
    return res.sendStatus(403);
  }
  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);

  try {
    for (const entry of body.entry || []) {
      // 1) Feed: post/commenti
      if (Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if (change.field === 'feed') {
            const value = change.value || {};
            const text = value.message || value.comment_message || value.description || '';
            const externalId = value.comment_id || value.post_id || value.video_id || value.photo_id || change.id || `${entry.id}:${Date.now()}`;
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

// --- Start ---
const PORT = process.env.PORT || 8080;
if (process.env.NODE_ENV === 'development') {
  app.post('/simulate/facebook', async (req, res) => {
    try {
      const text = req.body.message;
      if (!text) {
        return res.status(400).json({ ok: false, error: "Missing field 'message'" });
      }

      // Usa lo stesso parser del webhook
      const parsed = await parseFacebookText({ text, hint: 'facebook:simulate' });

      // Inserisce in listings con source=facebook:simulate
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
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});

export default app;
