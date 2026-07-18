// server/src/lib/fbSend.js

// Usa il Page Access Token della Pagina
const PAGE_ACCESS_TOKEN = (process.env.FB_PAGE_ACCESS_TOKEN || '').trim();
const SEND_TIMEOUT_MS = 10000;

/**
 * Chiama la Send API di Facebook
 */
async function callSendAPI(body) {
  if (!PAGE_ACCESS_TOKEN) {
    console.warn('[sendFb] Missing FB_PAGE_ACCESS_TOKEN');
    return;
  }

  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`;
  // Senza timeout, una risposta appesa di Facebook blocca la richiesta
  // (e con essa il webhook che l'ha innescata) a tempo indeterminato.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // Facebook risponde sempre 200/OK anche con errori applicativi nel JSON
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json?.error) {
      console.error('[sendFb] FB error', resp.status, json?.error || json);
    }
    return json;
  } catch (e) {
    console.error('[sendFb] Exception:', e);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Invia un messaggio testuale semplice
 */
export async function sendFbText(recipientId, text) {
  return callSendAPI({
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: { text }
  });
}

/**
 * Invia un messaggio con Quick Replies
 * replies: [{ title: "🚆 Treno", payload: "TYPE_TRENO" }, { title: "🏨 Hotel", payload: "TYPE_HOTEL" }]
 */
export async function sendFbQuickReplies(recipientId, text, replies = []) {
  return callSendAPI({
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: {
      text,
      quick_replies: replies.map(r => ({
        content_type: 'text',
        title: r.title,
        payload: r.payload
      }))
    }
  });
}
