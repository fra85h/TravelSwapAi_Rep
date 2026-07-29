// lib/usePriceSuggestAI.js
import { useCallback, useState } from "react";
import { fetchJson } from "./backendApi";

/**
 * Hook per il suggerimento di prezzo con AI VERA in creazione annuncio,
 * su una bozza senza ancora un listing.id:
 * POST /api/listings/price-suggest
 *
 * Diverso da usePriceCheck (che GIUDICA un prezzo già scelto su un annuncio
 * già pubblicato, verdict low/fair/high): questo PROPONE un numero da zero.
 *
 * Ritorna: { suggestPriceAI, loading }
 * - suggestPriceAI(draft, locale) -> { available:true, suggestedPrice, explanation } | { available:false, reason }
 */
export function usePriceSuggestAI() {
  const [loading, setLoading] = useState(false);

  const suggestPriceAI = useCallback(async (draft, locale = "it") => {
    setLoading(true);
    try {
      const res = await fetchJson("/api/listings/price-suggest", {
        method: "POST",
        body: { ...draft, locale },
      });
      return res || { available: false, reason: "empty_response" };
    } catch (e) {
      console.log("[priceSuggestAI][client] error =", e);
      return { available: false, reason: e?.message || String(e) };
    } finally {
      setLoading(false);
    }
  }, []);

  return { suggestPriceAI, loading };
}
