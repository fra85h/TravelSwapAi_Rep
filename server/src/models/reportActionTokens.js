// server/src/models/reportActionTokens.js — token "un click" per le azioni
// pausa/elimina inviate nell'email di notifica segnalazione (vedi
// migrazione 20260731100000_report_action_tokens.sql). Stesso pattern di
// fbLink.js: token random, scadenza, consumo atomico via UPDATE con
// `used_at IS NULL` come condizione, per evitare che due richieste quasi
// simultanee sullo stesso token passino entrambe.
import crypto from "crypto";
import { supabase } from "../db.js";

const TOKEN_TTL_DAYS = 7;

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/** Crea un token monouso per `action` ('pause'|'delete') su `listingId`, legato a `reportId`. */
export async function createReportActionToken(reportId, listingId, action) {
  if (!supabase) throw new Error("Supabase client not configured");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("report_action_tokens")
    .insert({ token, report_id: reportId, listing_id: listingId, action, expires_at: expiresAt });
  if (error) throw error;

  return { token, expiresAt };
}

/** Legge un token senza consumarlo (per mostrare la pagina di conferma). */
export async function peekReportActionToken(token) {
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase
    .from("report_action_tokens")
    .select("token, report_id, listing_id, action, expires_at, used_at, listings(title, status)")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Consuma atomicamente il token. Ritorna la riga consumata, oppure null se
 * non trovato, già usato o scaduto (nessuna di queste condizioni è un
 * errore: sono esiti attesi per un link cliccato due volte o troppo tardi).
 */
export async function consumeReportActionToken(token) {
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase
    .from("report_action_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("token, report_id, listing_id, action")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
