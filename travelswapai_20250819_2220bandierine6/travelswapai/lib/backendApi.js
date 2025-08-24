import { supabase } from "./supabase";
// lib/backendApi.js
const BASE = (process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");


function ensureBase() {
  if (!BASE) {
    throw new Error("EXPO_PUBLIC_API_BASE non impostata");
  }
}

/*async function fetchJson(path, opts = {}) {
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
}*/
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");

/*export async function fetchJson(path, opts = {}) {
  console.log("qui sono dentro fetchJSon");
  const url = /^https?:\/\//.test(path) ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  console.log("qui stampo url");
    console.log(url);
  // Prendi il token della sessione corrente
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, { ...opts, headers });
 console.log("qui stampo res");
  

  const text = await res.text();
    console.log(text);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}*/
export async function fetchJson(path, opts = {}) {
  // Costruisci URL evitando doppio slash
  const base = (typeof API_BASE === "string" ? API_BASE : "").replace(/\/+$/, "");
  const url = /^https?:\/\//.test(path)
    ? path
    : `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  // Token Supabase (se c'è)
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  // Header di default: Accept JSON; Content-Type JSON solo se stai mandando body string/JSON
  const defaultHeaders = {
    Accept: "application/json",
    ...(typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Merge: gli header passati in opts sovrascrivono i default
  const headers = { ...defaultHeaders, ...(opts.headers || {}) };

  // Debug utile
  console.log("[fetchJson] ->", url, opts?.method || "GET");

  const res = await fetch(url, { ...opts, headers });

  // Leggi corpo una sola volta
  const text = await res.text().catch(() => "");

  if (!res.ok) {
    const snippet = text ? ` — ${text.slice(0, 200)}` : "";
    throw new Error(`HTTP ${res.status} ${res.statusText}${snippet}`);
  }

  // Parse solo se è JSON
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { return text ? JSON.parse(text) : null; }
    catch { /* se JSON invalido, restituisci raw */ return text || null; }
  }
  return text || null; // es. 204 No Content -> null
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
// Orchestrazione AI → Snapshot
// PRIMA
// export async function recomputeAIAndSnapshot({ topPerListing = 3, maxTotal = 50 } = {}) {

// DOPO: accetta userId come primo argomento
export async function recomputeAIAndSnapshot(
  userId,
  { topPerListing = 3, maxTotal = 50 } = {}
) {
  // prendi il token (se presente) per l’Authorization
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
console.log("userid dentro recomputeAIandSnap");
  // fallback: se non l’hai passato, prova a ricavarlo dalla sessione Supabase
  if (!userId) {console.log("qui entro?");
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id || null;
  }
  
  if (!userId) throw new Error("missing userId");

  return fetchJson(`/api/matches/ai/recompute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",              // ⬅️ importante per req.body
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ userId, topPerListing, maxTotal }),
  });
}


/*export async function recomputeAIAndSnapshot(
  userId,
  { topPerListing = 3, maxTotal = 50 } = {}
) {
  if (!userId) throw new Error("userId mancante");
  console.log("qui sono dentro la function recomputeaiandsnapshot");
  return fetchJson(`/api/matches/ai/recompute`, {
    method: "POST",
    body: JSON.stringify({ userId, topPerListing, maxTotal }),
  });
}*/