// lib/reports.js — segnalazione di annunci/venditori sospetti
import { supabase } from "./supabase";

// Codici motivo consentiti (devono combaciare col CHECK in reports_setup.sql)
export const REPORT_REASONS = ["fake", "scam", "inappropriate", "duplicate", "other"];

/**
 * Invia una segnalazione. reporter_id è sempre l'utente corrente.
 * Ritorna { ok:true } | { ok:false, alreadyReported?:true, error? }.
 */
export async function submitReport({ listingId = null, reportedUserId = null, reason, details = null }) {
  if (!REPORT_REASONS.includes(reason)) return { ok: false, error: "invalid_reason" };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    listing_id: listingId,
    reported_user_id: reportedUserId,
    reason,
    details: details || null,
  });

  if (error) {
    // 23505 = violazione unique index (annuncio già segnalato da questo utente)
    if (error.code === "23505") return { ok: false, alreadyReported: true };
    return { ok: false, error: error.message || String(error) };
  }
  return { ok: true };
}
