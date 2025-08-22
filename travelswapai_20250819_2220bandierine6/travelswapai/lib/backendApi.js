// lib/backendApi.js
const BASE = (process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

function ensureBase() {
  if (!BASE) {
    throw new Error("EXPO_PUBLIC_API_BASE non impostata");
  }
}

async function fetchJson(path, opts = {}) {
  ensureBase();
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  // Se non 2xx -> leggi testo e lancia
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const msg = text && text.trim().startsWith("<")
      ? `HTTP ${res.status} — HTML ricevuto (probabile reverse-proxy/redirect)`
      : `HTTP ${res.status}: ${text || res.statusText}`;
    throw new Error(msg);
  }

  // Prova JSON, blocca se ricevi HTML
  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error("Risposta HTML inattesa (probabile proxy o URL BASE errato)");
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON Parse error: ${e?.message || e}`);
  }
}

// -------- API snapshot utente --------
export async function getUserSnapshot(userId) {
  if (!userId) throw new Error("userId mancante");
  return fetchJson(`/api/matches/snapshot?userId=${encodeURIComponent(userId)}`);
}

export async function recomputeUserSnapshot(userId, { topPerListing = 3, maxTotal = 50 } = {}) {
  if (!userId) throw new Error("userId mancante");
  return fetchJson(`/api/matches/snapshot/recompute`, {
    method: "POST",
    body: JSON.stringify({ userId, topPerListing, maxTotal }),
  });
}

// (facoltativo) health per debug rapido
export async function apiHealth() {
  return fetchJson(`/api/health`);
}

// debug: stampa BASE una volta
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log("[backendApi] BASE =", BASE || "(vuota!)");
}
