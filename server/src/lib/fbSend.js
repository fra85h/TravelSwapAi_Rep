// server/src/lib/fbSend.js

// Facebook Messenger usa il Page Access Token della Pagina. Instagram (nel
// percorso "classico": account IG collegato alla stessa Pagina, prodotto
// Instagram sulla stessa Meta App) riusa secondo la documentazione Meta la
// STESSA Send API con lo stesso Page Access Token esteso col permesso
// instagram_manage_messages — non ancora verificato con un account reale
// (nessun setup Meta esistente al momento in cui è stato scritto). Se la
// console Meta genera invece un token separato per l'asset Instagram, va
// impostato IG_PAGE_ACCESS_TOKEN per usarlo al posto del fallback condiviso.
const PAGE_ACCESS_TOKEN = (process.env.FB_PAGE_ACCESS_TOKEN || '').trim();
const IG_ACCESS_TOKEN = (process.env.IG_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN || '').trim();
const SEND_TIMEOUT_MS = 10000;

/**
 * Chiama la Send API (Messenger e Instagram condividono lo stesso endpoint Graph)
 */
async function callSendAPI(body, token, logLabel) {
  if (!token) {
    console.warn(`[${logLabel}] Missing access token`);
    return;
  }

  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${encodeURIComponent(token)}`;
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
      console.error(`[${logLabel}] FB error`, resp.status, json?.error || json);
    }
    return json;
  } catch (e) {
    console.error(`[${logLabel}] Exception:`, e);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function textBody(recipientId, text) {
  return {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: { text }
  };
}

/**
 * replies: [{ title: "🚆 Treno", payload: "TYPE_TRENO" }, { title: "🏨 Hotel", payload: "TYPE_HOTEL" }]
 */
function quickRepliesBody(recipientId, text, replies) {
  return {
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
  };
}

/** Invia un messaggio testuale semplice via Messenger */
export async function sendFbText(recipientId, text) {
  return callSendAPI(textBody(recipientId, text), PAGE_ACCESS_TOKEN, 'sendFb');
}

/** Invia un messaggio con Quick Replies via Messenger */
export async function sendFbQuickReplies(recipientId, text, replies = []) {
  return callSendAPI(quickRepliesBody(recipientId, text, replies), PAGE_ACCESS_TOKEN, 'sendFb');
}

/** Invia un messaggio testuale semplice via Instagram DM */
export async function sendInstagramText(recipientId, text) {
  return callSendAPI(textBody(recipientId, text), IG_ACCESS_TOKEN, 'sendIg');
}

/** Invia un messaggio con Quick Replies via Instagram DM */
export async function sendInstagramQuickReplies(recipientId, text, replies = []) {
  return callSendAPI(quickRepliesBody(recipientId, text, replies), IG_ACCESS_TOKEN, 'sendIg');
}
