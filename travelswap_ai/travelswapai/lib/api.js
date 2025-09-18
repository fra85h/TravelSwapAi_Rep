// lib/api.js — REST helpers for Supabase (Snack-friendly)

// 🔧 Put your actual project values here
const PROJECT_URL = "https://jkjjpgrnbnbaplbxzhgt.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprampwZ3JuYm5iYXBsYnh6aGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NDU4MzMsImV4cCI6MjA3MDQyMTgzM30.1Exr_yxKrHBmCkK5HWKfCZpjju7Qn2I1Zx-3mGNYSAE";

// Build REST endpoint url
const REST = (path, query = "") =>
  `${PROJECT_URL}/rest/v1/${path}${query ? `?${query}` : ""}`;

// Edge Function for AI matching (optional)
const FUN_AI = `${PROJECT_URL}/functions/v1/ai-matching`;

const headersJson = {
  "Content-Type": "application/json",
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
};
const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "http://127.0.0.1:8080/api";

export async function listMatches() {
  const url = `${API_BASE}/matches?userId=u1&mock=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function recomputeMatches() {
  const url = `${API_BASE}/matches/recompute`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "u1" }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
// Generic GET (returns JSON array or object)
export async function restGet(path, { query = "", headers = {} } = {}) {
  const res = await fetch(REST(path, query), {
    method: "GET",
    headers: { ...headersJson, ...headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Generic POST (insert)
export async function restPost(path, body, { headers = {}, single = false } = {}) {
  const res = await fetch(REST(path), {
    method: "POST",
    headers: { Prefer: single ? "return=representation" : "return=minimal", ...headersJson, ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return single ? res.json() : true;
}

// Generic PATCH (update)
export async function restPatch(path, matchQuery, body, { headers = {}, single = false } = {}) {
  const res = await fetch(REST(path, matchQuery), {
    method: "PATCH",
    headers: { Prefer: single ? "return=representation" : "return=minimal", ...headersJson, ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${path} failed: ${res.status} ${text}`);
  }
  return single ? res.json() : true;
}

// Generic DELETE
export async function restDelete(path, matchQuery, { headers = {} } = {}) {
  const res = await fetch(REST(path, matchQuery), {
    method: "DELETE",
    headers: { ...headersJson, ...headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE ${path} failed: ${res.status} ${text}`);
  }
  return true;
}

// ---- DOMAIN-SPECIFIC HELPERS ----

// Profiles
export async function apiGetProfile(userId) {
  const q = new URLSearchParams({ select: "*", id: `eq.${userId}` }).toString();
  const rows = await restGet("profiles", { query: q });
  return rows?.[0] ?? null;
}

export async function apiUpsertProfile(profile) {
  // Upsert via POST with Prefer: resolution=merge-duplicates
  const res = await fetch(REST("profiles"), {
    method: "POST",
    headers: {
      ...headersJson,
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: JSON.stringify([profile]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`UPSERT profiles failed: ${res.status} ${text}`);
  }
  const rows = await res.json();
  return rows?.[0] ?? null;
}

// Listings
export async function apiInsertListing(payload) {
  const rows = await restPost("listings", payload, { single: true });
  return rows?.[0] ?? rows; // handle PostgREST returning array/object
}

export async function apiUpdateListing(id, patch) {
  const q = new URLSearchParams({ id: `eq.${id}` }).toString();
  const rows = await restPatch("listings", q, patch, { single: true });
  return rows?.[0] ?? rows;
}

export async function apiDeleteListing(id) {
  const q = new URLSearchParams({ id: `eq.${id}` }).toString();
  return restDelete("listings", q);
}

export async function apiGetListing(id) {
  const q = new URLSearchParams({ select: "*", id: `eq.${id}` }).toString();
  const rows = await restGet("listings", { query: q });
  return rows?.[0] ?? null;
}

export async function apiListMyListings(ownerId, { status, limit = 50 } = {}) {
  const p = new URLSearchParams({ select: "*", owner_id: `eq.${ownerId}`, order: "created_at.desc", limit: String(limit) });
  if (status) p.set("status", `eq.${status}`);
  const rows = await restGet("listings", { query: p.toString() });
  return rows;
}

// Offers (matches/handshakes between two listings)
export async function apiCreateOffer(payload) {
  // payload: { from_listing_id, to_listing_id, status?, message? }
  const rows = await restPost("offers", payload, { single: true });
  return rows?.[0] ?? rows;
}

export async function apiListOffersForListing(listingId) {
  const p = new URLSearchParams({ select: "*", or: `(from_listing_id.eq.${listingId},to_listing_id.eq.${listingId})`, order: "created_at.desc" });
  return restGet("offers", { query: p.toString() });
}

export async function apiUpdateOffer(id, patch) {
  const q = new URLSearchParams({ id: `eq.${id}` }).toString();
  const rows = await restPatch("offers", q, patch, { single: true });
  return rows?.[0] ?? rows;
}

// AI Matching (Edge Function). Optional.
export async function apiGetAIMatches({ listingId, k = 10, pricePct = 30, dayTol = 2 }) {
  const res = await fetch(FUN_AI, {
    method: "POST",
    headers: { ...headersJson },
    body: JSON.stringify({ listing_id: listingId, k, price_pct: pricePct, day_tol: dayTol }),
  });
  if (!res.ok) throw new Error(await res.text());
  const j = await res.json();
  return j.results ?? [];
}

export const _private = { REST, headersJson };
