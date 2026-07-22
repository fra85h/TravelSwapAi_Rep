// server/src/routes/notify.js — email transazionali sugli eventi critici del
// funnel (Punto 5). Il problema: senza push, chi non tiene l'app aperta non
// sa che ha ricevuto una proposta o che la sua è stata accettata — e un
// biglietto scade in fretta. Qui inviamo un'email di avviso, riusando il
// mailer SMTP già presente (fail-safe: se SMTP non è configurato è un no-op).
//
// L'indirizzo del destinatario NON è noto al client (la RLS nasconde le email
// altrui): lo risolve il server con la service-role key. Ogni endpoint
// verifica che il chiamante sia davvero parte dell'offerta, così non si può
// usare per spammare email a caso.
import express from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimitNotify } from '../middleware/rateLimit.js';
import { supabase } from '../db.js';
import { sendMail, mailerConfigured } from '../lib/mailer.js';
import { sendExpoPush } from '../lib/push.js';

export const notifyRouter = express.Router();

async function loadOffer(offerId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from('offers')
    .select('id, type, proposer_id, to_listing_id, status')
    .eq('id', offerId)
    .maybeSingle();
  return data || null;
}

async function listingOwnerAndTitle(listingId) {
  if (!supabase || !listingId) return null;
  const { data } = await supabase
    .from('listings')
    .select('user_id, title')
    .eq('id', listingId)
    .maybeSingle();
  return data || null;
}

async function emailOf(userId) {
  if (!supabase || !userId) return null;
  const { data } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  return (data?.email || '').trim() || null;
}

// Proposta ricevuta: la chiama il PROPONENTE dopo aver creato l'offerta.
// Destinatario = proprietario dell'annuncio target.
notifyRouter.post('/offer-received', requireAuth, rateLimitNotify, async (req, res) => {
  try {
    const offerId = String(req.body?.offerId || '').trim();
    if (!offerId) return res.status(400).json({ error: 'offerId required' });

    const offer = await loadOffer(offerId);
    if (!offer) return res.json({ ok: true, sent: false });
    if (String(offer.proposer_id) !== String(req.user?.id)) {
      return res.status(403).json({ error: 'not allowed' });
    }

    const target = await listingOwnerAndTitle(offer.to_listing_id);
    if (!target?.user_id) return res.json({ ok: true, sent: false });

    // Push nativo (dormiente finché non ci sono token registrati), indipendente
    // dall'email: la notifica in-app la crea già il trigger DB.
    sendExpoPush(target.user_id, {
      title: offer.type === 'swap' ? 'Nuova proposta di scambio' : 'Nuova offerta di acquisto',
      body: `Su «${target.title || ''}»`,
      data: { type: 'offer_received', offerId: offer.id, listingId: offer.to_listing_id },
    });

    if (!mailerConfigured()) return res.json({ ok: true, sent: false, reason: 'mailer_not_configured' });
    const to = await emailOf(target.user_id);
    if (!to) return res.json({ ok: true, sent: false, reason: 'no_email' });

    const kind = offer.type === 'swap' ? 'scambio' : 'acquisto';
    const sent = await sendMail({
      to,
      subject: `[TravelSwapAI] Nuova proposta di ${kind}`,
      text: [
        `Hai ricevuto una proposta di ${kind} per il tuo annuncio "${target.title || ''}".`,
        '',
        'Apri TravelSwapAI (sezione Attività) per vederla e rispondere prima che scada.',
      ].join('\n'),
    });
    return res.json({ ok: true, sent });
  } catch (e) {
    console.error('[notify/offer-received]', e?.message || e);
    return res.json({ ok: true, sent: false });
  }
});

// Proposta accettata: la chiama chi ACCETTA (proprietario dell'annuncio).
// Destinatario = proponente.
notifyRouter.post('/offer-accepted', requireAuth, rateLimitNotify, async (req, res) => {
  try {
    const offerId = String(req.body?.offerId || '').trim();
    if (!offerId) return res.status(400).json({ error: 'offerId required' });

    const offer = await loadOffer(offerId);
    if (!offer) return res.json({ ok: true, sent: false });

    const target = await listingOwnerAndTitle(offer.to_listing_id);
    if (!target || String(target.user_id) !== String(req.user?.id)) {
      return res.status(403).json({ error: 'not allowed' });
    }

    // Push nativo (dormiente finché non ci sono token registrati), indipendente
    // dall'email: la notifica in-app la crea già il trigger DB.
    sendExpoPush(offer.proposer_id, {
      title: 'Proposta accettata',
      body: `La tua proposta su «${target.title || ''}» è stata accettata`,
      data: { type: 'offer_accepted', offerId: offer.id, listingId: offer.to_listing_id },
    });

    if (!mailerConfigured()) return res.json({ ok: true, sent: false, reason: 'mailer_not_configured' });
    const to = await emailOf(offer.proposer_id);
    if (!to) return res.json({ ok: true, sent: false, reason: 'no_email' });

    const sent = await sendMail({
      to,
      subject: `[TravelSwapAI] La tua proposta è stata accettata`,
      text: [
        `La tua proposta per "${target.title || ''}" è stata accettata!`,
        '',
        'Apri TravelSwapAI e la chat per organizzare lo scambio con l\'altra persona.',
      ].join('\n'),
    });
    return res.json({ ok: true, sent });
  } catch (e) {
    console.error('[notify/offer-accepted]', e?.message || e);
    return res.json({ ok: true, sent: false });
  }
});
