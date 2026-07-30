// server/src/routes/offers.js
import express from "express";
import { supabase } from "../db.js";
import { requireCronSecret } from "../middleware/requireCronSecret.js";
import { rateLimitOffers } from "../middleware/rateLimit.js";

export const offersRouter = express.Router();

// Come /api/chains/recompute e /api/saved-searches/recompute: protetto da
// secret condiviso, non dal login utente — scade le proposte pending di
// TUTTI gli utenti (48h da expires_at, vedi supabase/migrations/
// 20260718110001_offers_timeout.sql). Facoltativo: la scadenza pigra già
// applicata da accept/decline_offer_any e dalle liste di Attività basta
// per la correttezza anche se questo endpoint non viene mai chiamato.
//
// release_all_stale_reservations (20260730120000): stessa logica ma per le
// offerte 'accepted' con reservation_expires_at scaduta (7 giorni). Prima
// esisteva solo release_my_stale_reservations, scoped ad auth.uid() e
// chiamata solo dal client al mount di AttivitaScreen — se nessuna delle
// due parti riapriva l'app, la prenotazione restava bloccata per sempre.
//
// remind_pending_confirmations / remind_pending_ratings (20260730180000):
// promemoria proattivi (analisi empatia, sezione C punto 10) — prima
// nessuno spingeva l'utente a confermare uno scambio accettato o a
// valutare una transazione finalizzata, si contava solo sull'iniziativa
// spontanea di riaprire l'app.
offersRouter.post("/recompute", rateLimitOffers, requireCronSecret, async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data: expired, error: e1 } = await supabase.rpc("expire_old_offers");
    if (e1) throw e1;
    const { data: releasedStale, error: e2 } = await supabase.rpc("release_all_stale_reservations");
    if (e2) throw e2;
    const { data: confirmReminders, error: e3 } = await supabase.rpc("remind_pending_confirmations");
    if (e3) throw e3;
    const { data: ratingReminders, error: e4 } = await supabase.rpc("remind_pending_ratings");
    if (e4) throw e4;
    return res.status(200).json({
      expired: expired ?? 0,
      releasedStale: releasedStale ?? 0,
      confirmReminders: confirmReminders ?? 0,
      ratingReminders: ratingReminders ?? 0,
    });
  } catch (e) {
    console.error("[offers/recompute] error:", e);
    return res.status(500).json({ error: 'Errore interno' });
  }
});
