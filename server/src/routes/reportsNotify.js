// server/src/routes/reportsNotify.js — notifica email per nuove segnalazioni.
// Il client inserisce la riga in `reports` direttamente su Supabase (RLS),
// poi chiama questo endpoint fire-and-forget per avvisare via email chi
// modera (REPORT_NOTIFY_TO). L'email è "best effort": se SMTP non è
// configurato risponde comunque 200 con sent:false — la segnalazione
// resta salvata a DB in ogni caso.
import express from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimitReportNotify } from '../middleware/rateLimit.js';
import { sendMail, mailerConfigured } from '../lib/mailer.js';

export const reportsNotifyRouter = express.Router();

const REASON_LABELS = {
  fake: 'Annuncio falso',
  scam: 'Possibile truffa',
  inappropriate: 'Contenuto inappropriato',
  duplicate: 'Annuncio duplicato',
  other: 'Altro',
};

reportsNotifyRouter.post(
  '/notify',
  requireAuth,
  rateLimitReportNotify,
  body('reason').isString().isLength({ min: 2, max: 40 }),
  body('listingId').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('listingTitle').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('reportedUserId').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('details').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array() });
    }

    const to = (process.env.REPORT_NOTIFY_TO || '').trim();
    if (!to || !mailerConfigured()) {
      // Nessun destinatario/SMTP: non è un errore del client
      return res.json({ ok: true, sent: false, reason: 'mailer_not_configured' });
    }

    const { listingId, listingTitle, reportedUserId, reason, details } = req.body;
    const reasonLabel = REASON_LABELS[reason] || reason;

    const lines = [
      'Nuova segnalazione su TravelSwapAI',
      '',
      `Motivo: ${reasonLabel} (${reason})`,
      listingTitle ? `Annuncio: ${listingTitle}` : null,
      listingId ? `ID annuncio: ${listingId}` : null,
      reportedUserId ? `Utente segnalato: ${reportedUserId}` : null,
      `Segnalato da: ${req.user?.id || 'sconosciuto'}`,
      details ? `Dettagli: ${details}` : null,
      '',
      `Data: ${new Date().toISOString()}`,
      '',
      'Controlla la tabella "reports" su Supabase per gestire la segnalazione.',
    ].filter((l) => l !== null);

    const sent = await sendMail({
      to,
      subject: `[TravelSwapAI] Segnalazione: ${reasonLabel}${listingTitle ? ` — ${listingTitle}` : ''}`,
      text: lines.join('\n'),
    });

    return res.json({ ok: true, sent });
  }
);
