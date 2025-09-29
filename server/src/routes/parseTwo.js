// server/src/routes/parseTwo.js
import express from 'express';
import OpenAI from 'openai';
import { rateLimitTrustScore } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const parseTwoRouter = express.Router();

/**
 * POST /ai/parse-two
 * Body: { description: string, type?: 'train'|'hotel' }
 * Returns: { one: {...}, two: {...}, detected: boolean, confidence: number }
 */
parseTwoRouter.post('/ai/parse-two', requireAuth, rateLimitTrustScore, async (req, res) => {
  try {
    const { description = '', type = '' } = req.body || {};
    const text = String(description || '').trim();
    const t = String(type || '').toLowerCase();
    if (!text) return res.status(400).json({ error: 'missing_description' });

    // If no API key, fallback to empty overrides but signal detected=false
    if (!process.env.OPENAI_API_KEY) {
      return res.json({ one: {}, two: {}, detected: false, confidence: 0.0 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Tool schema to extract up to 2 items for train/hotel
    const tool = {
      type: 'function',
      function: {
        name: 'extract_two_listings',
        description: 'Parse the description and extract up to TWO items with normalized fields for train or hotel. Dates as YYYY-MM-DD, datetimes as ISO 8601.',
        parameters: {
          type: 'object',
          properties: {
            detected: { type: 'boolean', description: 'True if the text clearly describes two distinct items.' },
            confidence: { type: 'number', description: '0..1 confidence.' },
            one: {
              type: 'object',
              description: 'First item fields (may be partial).',
              properties: {
                title: { type: 'string' },
                location: { type: 'string' },
                check_in: { type: 'string', description: 'YYYY-MM-DD (hotel)' },
                check_out: { type: 'string', description: 'YYYY-MM-DD (hotel)' },
                depart_at: { type: 'string', description: 'ISO YYYY-MM-DDTHH:mm (train)' },
                arrive_at: { type: 'string', description: 'ISO YYYY-MM-DDTHH:mm (train)' },
              }
            },
            two: {
              type: 'object',
              description: 'Second item fields (may be partial).',
              properties: {
                title: { type: 'string' },
                location: { type: 'string' },
                check_in: { type: 'string' },
                check_out: { type: 'string' },
                depart_at: { type: 'string' },
                arrive_at: { type: 'string' },
              }
            }
          },
          required: ['detected','confidence','one','two'],
          additionalProperties: false
        }
      }
    };

    const sys = [
      { role: 'system', content: 'You are a helpful assistant that extracts up to two normalized items for a marketplace listing. Answer ONLY by calling the provided function.' }
    ];
    const user = [
      { role: 'user', content: `Type: ${t || 'auto'}\nText: ${text}` }
    ];

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini-2024-07-18',
      messages: [...sys, ...user],
      tools: [tool],
      tool_choice: { type: 'function', function: { name: 'extract_two_listings' } },
      temperature: 0.2
    });

    const call = resp?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed = { detected: false, confidence: 0, one: {}, two: {} };
    if (call?.function?.name === 'extract_two_listings') {
      try {
        const args = JSON.parse(call.function.arguments || '{}');
        parsed = {
          detected: !!args.detected,
          confidence: Number(args.confidence) || 0,
          one: args.one || {},
          two: args.two || {},
        };
      } catch {}
    }

    return res.json(parsed);
  } catch (e) {
    console.error('[parse-two] error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});
