// travelswapai/lib/backendApi.js
const envBase = process.env.EXPO_PUBLIC_API_BASE;
function guessBase() {
  if (typeof navigator !== "undefined" && /iPhone|iPad|Mac/.test(navigator.userAgent || "")) return "http://localhost:8080";
  return "http://10.0.2.2:8080";
}
export const BASE = envBase || guessBase();

/* Snapshot “Per te” */
export async function getUserSnapshot(userId) {
  const res = await fetch(`${BASE}/api/matches/snapshot?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`snapshot GET failed: ${res.status}`);
  return res.json();
}
export async function recomputeUserSnapshot(userId, opts = {}) {
  const res = await fetch(`${BASE}/api/matches/snapshot/recompute`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ userId, topPerListing: opts.topPerListing ?? 3, maxTotal: opts.maxTotal ?? 50 }),
  });
  if (!res.ok) { const t = await res.text().catch(()=> ""); throw new Error(`snapshot RECOMPUTE failed: ${res.status} ${t}`); }
  return res.json();
}

/* Pairwise per annuncio */
export async function getListingMatches(fromListingId, limit = 100) {
  const res = await fetch(`${BASE}/api/matches?fromListingId=${encodeURIComponent(fromListingId)}&limit=${limit}`);
  if (!res.ok) throw new Error(`pairwise GET failed: ${res.status}`);
  return res.json();
}
export async function recomputeForListing(fromListingId) {
  const res = await fetch(`${BASE}/api/matches/recompute`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ fromListingId }),
  });
  if (!res.ok) { const t = await res.text().catch(()=> ""); throw new Error(`pairwise RECOMPUTE failed: ${res.status} ${t}`); }
  return res.json();
}
