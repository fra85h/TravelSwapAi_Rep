// server/src/models/fbLink.js — collegamento identità Messenger<->account
// TravelSwapAI (vedi migrazione 20260713040000_fb_messenger_link.sql).
import crypto from "crypto";
import { supabase } from "../db.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // niente 0/O/1/I/L: si scrive a mano
const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 15;

function randomCode() {
  let out = "";
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

// Vero solo per stringhe che HANNO LA FORMA di un codice (lunghezza e
// alfabeto): usato per decidere se un messaggio Messenger va trattato
// come tentativo di collegamento invece che come testo di un annuncio.
export function looksLikeLinkCode(text) {
  const s = String(text || "").trim().toUpperCase();
  if (s.length !== CODE_LENGTH) return false;
  return [...s].every((ch) => CODE_ALPHABET.includes(ch));
}

/**
 * Genera un codice monouso per l'utente autenticato, valido 15 minuti.
 * Elimina prima eventuali codici non consumati dello stesso utente,
 * cosicché un solo codice attivo per volta e niente accumulo di righe.
 */
export async function createLinkCode(userId) {
  if (!supabase) throw new Error("Supabase client not configured");
  if (!userId) throw new Error("Missing userId");

  const { error: delError } = await supabase
    .from("fb_link_codes")
    .delete()
    .eq("user_id", userId)
    .is("used_at", null);
  if (delError) console.error("[fbLink] createLinkCode: errore pulizia codici precedenti:", delError.message);

  const code = randomCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60000).toISOString();

  const { error } = await supabase
    .from("fb_link_codes")
    .insert({ code, user_id: userId, expires_at: expiresAt });
  if (error) throw error;

  return { code, expiresAt, ttlMinutes: CODE_TTL_MINUTES };
}

/**
 * Prova a consumare `text` come codice di collegamento per `senderId`.
 * Ritorna { linked: true, userId } se andata a buon fine, altrimenti
 * { linked: false, reason }. Non lancia mai per input invalido/scaduto
 * (sono esiti attesi, non errori) — solo per problemi di connessione DB.
 */
export async function tryLinkFromMessage(senderId, text) {
  if (!supabase) throw new Error("Supabase client not configured");
  if (!looksLikeLinkCode(text)) return { linked: false, reason: "not_a_code" };

  const code = String(text).trim().toUpperCase();
  const { data: row, error } = await supabase
    .from("fb_link_codes")
    .select("code, user_id, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { linked: false, reason: "not_found" };
  if (row.used_at) return { linked: false, reason: "already_used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { linked: false, reason: "expired" };

  // Consumo atomico: la select sopra da sola non basta a escludere due
  // richieste quasi simultanee con lo stesso codice (es. inoltrato per
  // errore a un altro sender) — un check-poi-update in due passi
  // lascerebbe entrambe passare il controllo `used_at` prima che una
  // delle due lo aggiorni. Con `used_at IS NULL` come condizione
  // dell'UPDATE, solo una richiesta può "vincere" la riga.
  const { data: consumed, error: consumeErr } = await supabase
    .from("fb_link_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", code)
    .is("used_at", null)
    .select("code")
    .maybeSingle();
  if (consumeErr) throw consumeErr;
  if (!consumed) return { linked: false, reason: "already_used" };

  const { error: linkErr } = await supabase
    .from("fb_account_links")
    .upsert({ sender_id: senderId, user_id: row.user_id }, { onConflict: "sender_id" });
  if (linkErr) throw linkErr;

  return { linked: true, userId: row.user_id };
}

/** user_id collegato a questo sender Messenger, o null se mai collegato. */
export async function getLinkedUserId(senderId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("fb_account_links")
    .select("user_id")
    .eq("sender_id", senderId)
    .maybeSingle();
  if (error) {
    console.error("[fbLink] getLinkedUserId error:", error.message);
    return null;
  }
  return data?.user_id || null;
}
