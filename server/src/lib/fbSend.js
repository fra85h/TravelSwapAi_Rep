const PAGE_ACCESS_TOKEN = (process.env.FB_PAGE_ACCESS_TOKEN || '').trim();

export async function sendFbText(recipientId, text) {
  if (!PAGE_ACCESS_TOKEN) {
    console.warn('[sendFbText] Missing FB_PAGE_ACCESS_TOKEN');
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
  async function callSendAPI(body) {
  if (!PAGE_ACCESS_TOKEN) {
    console.warn('[sendFb] Missing FB_PAGE_ACCESS_TOKEN');
    return;
  }
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`;
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error('[sendFb] FB error', resp.status, err);
  }
}
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`;
  const body = {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: { text }
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error('[sendFbText] FB error', resp.status, err);
  }
}
