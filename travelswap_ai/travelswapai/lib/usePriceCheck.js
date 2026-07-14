// lib/usePriceCheck.js
import { useCallback, useState } from "react";
import { fetchJson } from "./backendApi";

/**
 * Hook per l'analisi prezzo con AI via backend:
 * GET /api/listings/:id/price-check
 *
 * Ritorna: { checkPrice, loading }
 * - checkPrice(listingId) -> { available:true, verdict, explanation } | { available:false, reason }
 */
export function usePriceCheck() {
  const [loading, setLoading] = useState(false);

  const checkPrice = useCallback(async (listingId) => {
    if (!listingId) return { available: false, reason: "missing_id" };
    setLoading(true);
    try {
      const path = `/api/listings/${encodeURIComponent(listingId)}/price-check`;
      const res = await fetchJson(path, { method: "GET" });
      return res || { available: false, reason: "empty_response" };
    } catch (e) {
      console.log("[priceCheck][client] error =", e);
      return { available: false, reason: e?.message || String(e) };
    } finally {
      setLoading(false);
    }
  }, []);

  return { checkPrice, loading };
}
