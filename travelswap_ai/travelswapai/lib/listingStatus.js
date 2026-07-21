// lib/listingStatus.js — stato annuncio: normalizzazione, colori badge e
// stati "conclusi" (transazione chiusa, non più modificabile). Condiviso tra
// ProfileScreen (i miei annunci) e ListingDetailScreen (dettaglio pubblico)
// per non avere due mappature che possono divergere.

export const STATUS_COLORS = {
  active: { bg: "#DCFCE7", border: "#86EFAC", fg: "#166534" },
  swapped: { bg: "#E0E7FF", border: "#A5B4FC", fg: "#3730A3" },
  sold: { bg: "#DBEAFE", border: "#93C5FD", fg: "#1E40AF" },
  reserved: { bg: "#FEF3C7", border: "#FCD34D", fg: "#92400E" },
  pending: { bg: "#FEF3C7", border: "#FCD34D", fg: "#92400E" },
  paused: { bg: "#F3F4F6", border: "#D1D5DB", fg: "#4B5563" },
  expired: { bg: "#FEE2E2", border: "#FCA5A5", fg: "#991B1B" },
};

/** Normalizza lo stato grezzo del DB (con i suoi alias) in una chiave
 * canonica, usata sia per il colore del badge sia per la chiave i18n
 * listing.state.*. */
export function normStatusKey(status) {
  const s = String(status || "").toLowerCase();
  if (["swapped", "traded", "exchanged"].includes(s)) return "swapped";
  if (["pending", "review"].includes(s)) return "pending";
  if (s === "sold") return "sold";
  if (s === "reserved") return "reserved";
  if (s === "expired") return "expired";
  if (s === "paused") return "paused";
  return "active"; // default e stringa vuota
}

/** Transazione conclusa (venduto/scambiato): l'annuncio non è più
 * modificabile né riattivabile, a differenza di paused/expired. */
export function isConcludedStatus(status) {
  const k = normStatusKey(status);
  return k === "sold" || k === "swapped";
}
