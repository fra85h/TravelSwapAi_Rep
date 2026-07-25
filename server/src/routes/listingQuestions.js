// server/src/routes/listingQuestions.js
import express from 'express';
import { isUUID } from '../util/uuid.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimitQuestions } from '../middleware/rateLimit.js';
import { askListingQuestion, validateAnswer, notifyQuestionAnswered } from '../models/listingQuestions.js';

export const listingQuestionsRouter = express.Router();

/**
 * POST /api/listing-questions  Body: { listingId, code }
 * Registra una domanda a risposta chiusa su un annuncio altrui e avvisa il
 * proprietario. Nessun testo libero: `code` deve stare nel catalogo condiviso.
 */
listingQuestionsRouter.post('/', requireAuth, rateLimitQuestions, async (req, res) => {
  try {
    const listingId = String(req.body?.listingId || '');
    const code = String(req.body?.code || '');
    if (!isUUID(listingId)) return res.status(400).json({ error: 'Invalid listing id' });

    const out = await askListingQuestion(listingId, code, req.user.id);
    return res.json(out);
  } catch (e) {
    console.error('[listing-questions] error:', e?.message || e);
    return res.status(400).json({ error: String(e?.message || e) });
  }
});

/**
 * POST /api/listing-questions/:id/answered  Body: { code, answer }
 * Notifica a chi aveva chiesto che è arrivata la risposta. La risposta è già
 * stata scritta dal client con la RPC answer_listing_question, che verifica la
 * proprietà dell'annuncio: qui si valida solo che il codice risposta esista
 * nel catalogo (cosa che il DB non può sapere) e si manda l'avviso.
 */
listingQuestionsRouter.post('/:id/answered', requireAuth, rateLimitQuestions, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isUUID(id)) return res.status(400).json({ error: 'Invalid question id' });
    validateAnswer(String(req.body?.code || ''), String(req.body?.answer || ''));

    await notifyQuestionAnswered(id);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[listing-questions answered] error:', e?.message || e);
    return res.status(400).json({ error: String(e?.message || e) });
  }
});
