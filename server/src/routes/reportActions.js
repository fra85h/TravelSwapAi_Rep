// server/src/routes/reportActions.js — azioni "un click" (pausa/elimina)
// sui link inviati nell'email di notifica segnalazione. Route PUBBLICA
// (nessun requireAuth): l'autorizzazione è il possesso del token nell'URL,
// non una sessione utente — chi clicca il link non è necessariamente
// loggato nell'app sullo stesso dispositivo. Vedi models/reportActionTokens.js
// per il ciclo di vita del token e la migrazione 20260731100000.
//
// GET  non consuma il token: mostra solo una pagina di conferma. Il consumo
// (ed effetto reale) avviene SOLO su POST, innescato da un click esplicito
// sul bottone — separare le due cose evita che un client email o uno
// scanner che pre-carica i link in GET esegua l'azione da solo.
import { Router } from 'express';
import { peekReportActionToken, consumeReportActionToken } from '../models/reportActionTokens.js';
import { moderatorSetListingStatus } from '../models/listings.js';
import { rateLimitReportActions } from '../middleware/rateLimit.js';

export const reportActionsRouter = Router();

const ACTION_LABELS = { pause: 'mettere in pausa', delete: 'eliminare definitivamente' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function page({ title, body }) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#1a1a2e;text-align:center}
h1{font-size:1.3rem}
p{color:#555;line-height:1.5}
button{background:#c9960c;color:#1a1a2e;border:none;border-radius:24px;padding:14px 28px;font-size:1rem;font-weight:600;cursor:pointer;margin-top:16px}
button.danger{background:#c0392b;color:#fff}
</style></head><body>${body}</body></html>`;
}

reportActionsRouter.get('/:token', rateLimitReportActions, async (req, res) => {
  try {
    const row = await peekReportActionToken(req.params.token);
    if (!row) {
      return res.status(404).send(page({
        title: 'Link non valido',
        body: '<h1>Link non valido</h1><p>Questo link non esiste o non è più utilizzabile.</p>',
      }));
    }
    if (row.used_at) {
      return res.send(page({
        title: 'Già gestito',
        body: '<h1>Azione già eseguita</h1><p>Questo link è già stato usato in precedenza.</p>',
      }));
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(410).send(page({
        title: 'Link scaduto',
        body: '<h1>Link scaduto</h1><p>Questo link non è più valido. Gestisci la segnalazione direttamente su Supabase.</p>',
      }));
    }

    const actionLabel = ACTION_LABELS[row.action] || row.action;
    const listingTitle = row.listings?.title || row.listing_id;
    const isDelete = row.action === 'delete';

    return res.send(page({
      title: 'Conferma azione',
      body: `<h1>Confermi di voler ${actionLabel} questo annuncio?</h1>
        <p>${escapeHtml(listingTitle)}</p>
        <form method="POST" action="/api/report-actions/${encodeURIComponent(row.token)}/confirm">
          <button type="submit" class="${isDelete ? 'danger' : ''}">${isDelete ? 'Elimina definitivamente' : 'Metti in pausa'}</button>
        </form>`,
    }));
  } catch (e) {
    console.error('[report-actions/get]', e);
    return res.status(500).send(page({ title: 'Errore', body: '<h1>Errore interno</h1><p>Riprova più tardi.</p>' }));
  }
});

reportActionsRouter.post('/:token/confirm', rateLimitReportActions, async (req, res) => {
  try {
    const consumed = await consumeReportActionToken(req.params.token);
    if (!consumed) {
      return res.status(410).send(page({
        title: 'Link non valido',
        body: '<h1>Link non valido, scaduto o già usato</h1><p>Nessuna azione eseguita.</p>',
      }));
    }

    const targetStatus = consumed.action === 'delete' ? 'deleted' : 'paused';
    const result = await moderatorSetListingStatus(consumed.listing_id, targetStatus);

    if (!result.ok && result.reason === 'already_deleted') {
      return res.send(page({
        title: 'Fatto',
        body: '<h1>Annuncio già eliminato</h1><p>Non serve nessuna ulteriore azione.</p>',
      }));
    }
    if (!result.ok && result.reason === 'not_found') {
      return res.send(page({ title: 'Fatto', body: '<h1>Annuncio non trovato</h1><p>Potrebbe essere già stato rimosso.</p>' }));
    }

    const doneLabel = consumed.action === 'delete' ? 'eliminato' : 'messo in pausa';
    return res.send(page({ title: 'Fatto', body: `<h1>Annuncio ${doneLabel}</h1><p>Operazione completata.</p>` }));
  } catch (e) {
    console.error('[report-actions/confirm]', e);
    return res.status(500).send(page({ title: 'Errore', body: '<h1>Errore interno</h1><p>Riprova più tardi.</p>' }));
  }
});
