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
import { createReportActionToken } from '../models/reportActionTokens.js';
import { isUUID } from '../util/uuid.js';

export const reportsNotifyRouter = express.Router();

// Dominio pubblico su cui gira questo stesso server (API + bundle web
// dell'app, vedi CLAUDE.md "Rebuild bundle web"): usato per costruire i
// link "un click" pausa/elimina nell'email. Non derivato da req.protocol/
// req.get('host') perché dietro il proxy di Render non è affidabile senza
// `trust proxy` configurato.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://travelswap.app').replace(/\/+$/, '');

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
  body('reportId').optional({ nullable: true }).isString().isLength({ max: 80 }),
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

    const { reportId, listingId, listingTitle, reportedUserId, reason, details } = req.body;
    const reasonLabel = REASON_LABELS[reason] || reason;

    // I link pausa/elimina hanno senso solo con un annuncio e una
    // segnalazione validi: il client li manda entrambi (submitReport
    // inserisce la riga in `reports` prima di chiamare questo endpoint),
    // ma restano opzionali per non rompere l'invio se mancano.
    let actionLinks = null;
    if (isUUID(reportId) && isUUID(listingId)) {
      try {
        const [pause, del] = await Promise.all([
          createReportActionToken(reportId, listingId, 'pause'),
          createReportActionToken(reportId, listingId, 'delete'),
        ]);
        actionLinks = {
          pause: `${PUBLIC_BASE_URL}/api/report-actions/${pause.token}`,
          delete: `${PUBLIC_BASE_URL}/api/report-actions/${del.token}`,
        };
      } catch (e) {
        console.error('[reportsNotify] errore creazione token azione:', e?.message || e);
      }
    }

    const lines = [
      'Nuova segnalazione su TravelSwap',
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
      actionLinks ? `Metti in pausa l'annuncio: ${actionLinks.pause}` : null,
      actionLinks ? `Elimina l'annuncio: ${actionLinks.delete}` : null,
      actionLinks ? '(link validi 7 giorni, chiedono conferma prima di agire)' : null,
      actionLinks ? '' : null,
      'Controlla la tabella "reports" su Supabase per gestire la segnalazione.',
    ].filter((l) => l !== null);

    const sent = await sendMail({
      to,
      subject: `[TravelSwap] Segnalazione: ${reasonLabel}${listingTitle ? ` — ${listingTitle}` : ''}`,
      text: lines.join('\n'),
    });

    return res.json({ ok: true, sent });
  }
);
