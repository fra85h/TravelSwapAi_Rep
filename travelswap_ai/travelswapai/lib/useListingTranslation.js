import { useCallback, useState } from "react";
import { fetchJson } from "./backendApi";

export function useListingTranslation() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const getTranslated = useCallback(async (listingId, targetLang) => {
    if (!listingId || !targetLang) return null;
    setLoading(true); setError(null);
     if (__DEV__) console.log("[translate][client] res =", res);
    try {
      return await fetchJson(`/api/listings/${listingId}/translate?lang=${encodeURIComponent(targetLang)}`);
    } catch (e) {
      setError(e?.message || "Translation error");
       if (__DEV__) console.log("[translate][client] res =", res);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { getTranslated, loading, error };
}
