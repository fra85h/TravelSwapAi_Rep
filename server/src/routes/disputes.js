// server/src/routes/disputes.js
import express from "express";
import { supabase } from "../db.js";
import { requireAdminSecret } from "../middleware/requireAdminSecret.js";
import { rateLimitDisputes } from "../middleware/rateLimit.js";

export const disputesRouter = express.Router();

// Protetto da secret condiviso (requireAdminSecret), non dal login utente:
// nessun concetto di ruolo admin esiste nel DB. Threat-modeling fase
// post-transazione, sezione A punto 1 — prima non esisteva NESSUNA via per
// risolvere una contestazione aperta con report_exchange_problem, l'unica
// uscita era annullare con cancel_accepted_offer_any (che ignora
// disputed_at e non lascia traccia della disputa).
disputesRouter.post("/resolve", rateLimitDisputes, requireAdminSecret, async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase client not configured");
    const { offerId, outcome, note } = req.body || {};
    if (!offerId || !outcome) {
      return res.status(400).json({ error: "offerId e outcome sono obbligatori" });
    }
    const { data, error } = await supabase.rpc("resolve_exchange_dispute", {
      p_offer_id_text: String(offerId),
      p_outcome: String(outcome),
      p_note: note ? String(note).slice(0, 1000) : null,
    });
    if (error) throw error;
    return res.status(200).json({ ok: true, offer: data });
  } catch (e) {
    console.error("[disputes/resolve] error:", e);
    return res.status(500).json({ error: 'Errore interno' });
  }
});

// Equivalente di /resolve ma per le segnalazioni sulle catene a 3
// (report_chain_problem, 20260730160000_chain_disputes.sql): qui non c'è
// nulla da annullare (la catena è già 'completed'), l'esito è solo
// informativo/di reputazione ('upheld' | 'dismissed').
disputesRouter.post("/resolve-chain", rateLimitDisputes, requireAdminSecret, async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase client not configured");
    const { disputeId, outcome, note } = req.body || {};
    if (!disputeId || !outcome) {
      return res.status(400).json({ error: "disputeId e outcome sono obbligatori" });
    }
    const { data, error } = await supabase.rpc("resolve_chain_dispute", {
      p_dispute_id: String(disputeId),
      p_outcome: String(outcome),
      p_note: note ? String(note).slice(0, 1000) : null,
    });
    if (error) throw error;
    return res.status(200).json({ ok: true, dispute: data });
  } catch (e) {
    console.error("[disputes/resolve-chain] error:", e);
    return res.status(500).json({ error: 'Errore interno' });
  }
});
