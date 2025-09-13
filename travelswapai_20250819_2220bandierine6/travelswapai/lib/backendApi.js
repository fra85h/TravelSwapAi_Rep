// lib/backendApi.js
import { supabase } from "./supabase";

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

// --- utils ---
const isTunnelHost = (u) => {
  try { return /app\.github\.dev$/i.test(new URL(u).host); } catch { return false; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// warm-up tunnel solo una volta
let tunnelWarmed = false;
async function warmUpTunnelOnce() {
  if (tunnelWarmed) return;
  if (!API_BASE || !isTunnelHost(API_BASE)) return;
  try {
    await fetch(`${API_BASE}/api/health`, { method: "GET" });
  } catch {}
  await sleep(200);
  tunnelWarmed = true;
}

// --- core fetch ---
/**
 * fetchJson(path, opts?)
 * - path può essere assoluto (https://) o relativo (/api/...)
 * - opts.body: se è un object → JSON.stringify + Content-Type
 * - timeoutMs: default 20000
 * - retry: 1 tentativo extra su 502/503/504
 */
export async function fetchJson(path, opts = {}) {
  if (!API_BASE && !/^https?:\/\//.test(path)) {
    throw new Error("EXPO_PUBLIC_API_BASE non impostata");
  }

  await warmUpTunnelOnce();

  const url = /^https?:\/\//.test(path)
    ? path
    : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  // Auth (Supabase)
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  // Body handling
  let body = opts.body;
  let contentTypeHeader = {};
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    contentTypeHeader = { "Content-Type": "application/json" };
  }

  const headers = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...contentTypeHeader,
    ...(opts.headers || {}),
  };

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 20000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const doFetch = async () => {
    return fetch(url, {
      ...opts,
      method: opts.method || "GET",
      headers,
      body,
      signal: controller.signal,
    });
  };

  let res;
  let attempts = 0;
  const maxAttempts = 2; // 1 retry su errori temporanei
  while (true) {
    attempts++;
    try {
      // eslint-disable-next-line no-console
      if (__DEV__) console.log("[fetchJson]", opts.method || "GET", url);
      res = await doFetch();
      break;
    } catch (e) {
      if (attempts >= maxAttempts) {
        clearTimeout(timer);
        if (e?.name === "AbortError") throw new Error(`Timeout dopo ${timeoutMs}ms: ${url}`);
        throw e;
      }
      await sleep(250);
    }
  }

  clearTimeout(timer);

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const isJson = ct.includes("application/json");
  const text = await res.text();

  // Riprova su 502/503/504 una volta se non già ritentato
  if (!res.ok && [502, 503, 504].includes(res.status) && attempts < maxAttempts) {
    await sleep(250);
    return fetchJson(path, { ...opts, timeoutMs }); // riparte tutto (compreso warmup già fatto)
  }

  // HTML inatteso (proxy/redirect)
  if (text && !isJson && /^\s*</.test(text)) {
    const msg = `Risposta HTML inattesa (probabile proxy/redirect). HTTP ${res.status}`;
    if (!res.ok) throw new Error(`${msg} — ${text.slice(0, 200)}`);
    throw new Error(msg);
  }

  // Errori HTTP → messaggio con snippet utile
  if (!res.ok) {
    // 429: messaggio più umano
    if (res.status === 429) {
      let parsed;
      try { parsed = text ? JSON.parse(text) : null; } catch {}
      const detail = parsed?.message || parsed?.error || text?.slice(0, 200) || res.statusText;
      throw new Error(`Limite raggiunto (429): ${detail}`);
    }
    const snippet = text ? ` — ${text.slice(0, 200)}` : "";
    throw new Error(`HTTP ${res.status}: ${res.statusText}${snippet}`);
  }

  // Success
  if (!text) return null; // es: 204 No Content
  if (isJson) {
    try { return JSON.parse(text); }
    catch (e) { throw new Error(`JSON Parse error: ${e?.message || e}`); }
  }
  // Se non JSON ma ok → torna stringa raw
  return text;
}

// -------- API convenience --------

// Health check rapido
export async function apiHealth() {
  return fetchJson(`/api/health`);
}

// Snapshot utente
export async function getUserSnapshot(userId) {
  if (!userId) throw new Error("userId mancante");
  return fetchJson(`/api/matches/snapshot?userId=${encodeURIComponent(userId)}`);
}

export async function recomputeUserSnapshot(userId, { topPerListing = 3, maxTotal = 50 } = {}) {
  if (!userId) throw new Error("userId mancante");
  return fetchJson(`/api/matches/snapshot/recompute`, {
    method: "POST",
    body: { userId, topPerListing, maxTotal },
  });
}

// Recompute AI → Snapshot (accetta userId esplicito o ricava dalla sessione)
export async function recomputeAIAndSnapshot(
  userId,
  { topPerListing = 3, maxTotal = 50 } = {}
) {
  // prova a ricavare l'utente se non passato
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id || null;
  }
  if (!userId) throw new Error("missing userId");

  return fetchJson(`/api/matches/ai/recompute`, {
    method: "POST",
    body: { userId, topPerListing, maxTotal },
  });
}

// Listings con filtro/ordinamento TrustScore
export async function fetchListings({ minTrust, sort } = {}) {
  const qs = new URLSearchParams();
  if (minTrust != null) qs.set("minTrust", String(minTrust));
  if (sort) qs.set("sort", sort);
  const q = qs.toString();
  return fetchJson(`/listings${q ? `?${q}` : ""}`);
}

// debug: stampa BASE una volta
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log("[backendApi] API_BASE =", API_BASE || "(vuota!)");
}
