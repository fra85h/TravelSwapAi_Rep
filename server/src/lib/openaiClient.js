// server/src/lib/openaiClient.js
// Factory unica per il client OpenAI, con timeout e retry sensati.
//
// Perché esiste: il default del SDK v4 è timeout 10 MINUTI. Una richiesta
// appesa verso OpenAI teneva quindi occupata per 10 minuti la richiesta HTTP
// che l'aveva innescata (e, nel caso del webhook Facebook/Instagram, il
// webhook stesso). Solo alcuni punti del codice (ai/score.js, ai/chainMatch.js,
// ai/chainExplain.js) si difendevano con un AbortController proprio; tutti gli
// altri — TrustScore, moderazione, analisi prezzo, parsing descrizioni,
// traduzioni — non avevano alcun limite.
//
// Qui il timeout è per SINGOLO tentativo: con maxRetries il tempo totale può
// arrivare a timeout * (1 + maxRetries), quindi i valori restano bassi.
// I punti che hanno già un AbortController proprio continuano a funzionare:
// vince semplicemente il primo dei due che scatta.
import OpenAI from "openai";

const DEFAULT_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 30_000);
const DEFAULT_MAX_RETRIES = Number(process.env.OPENAI_MAX_RETRIES || 1);

/**
 * Ritorna un client OpenAI configurato, o null se manca la chiave (tutti i
 * chiamanti gestiscono già il caso "AI non disponibile" con un fallback).
 * @param {{ timeoutMs?: number, maxRetries?: number }} [opts]
 */
export function createOpenAIClient({ timeoutMs, maxRetries } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    timeout: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : DEFAULT_MAX_RETRIES,
  });
}
