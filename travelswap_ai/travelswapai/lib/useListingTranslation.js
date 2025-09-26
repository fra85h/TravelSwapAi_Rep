// travelswapai/lib/useListingTranslation.js
import { useCallback, useRef, useState } from "react";
import { fetchJson } from "./backendApi"; // usa il tuo helper già configurato

/**
 * Hook per tradurre titolo+descrizione di un listing via backend:
 * GET /api/listings/:id/translate?lang=xx
 *
 * Ritorna: { getTranslated, loading, error }
 * - getTranslated(listingId, lang) -> { title, description, translated, lang, originalLang, cached }
 */
export function useListingTranslation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // cache in-memory: key = `${id}|${lang}`
  const cacheRef = useRef(new Map());

  const normLang = (l) => {
    if (!l) return "en";
    // prendi solo il codice 'xx' se arriva 'xx-YY'
    const xx = String(l).toLowerCase().split("-")[0];
    return xx || "en";
    // se vuoi forzare l'italiano di default, cambia in "it"
  };

  const getTranslated = useCallback(async (listingId, lang) => {
    setError(null);
    if (!listingId) return null;

    const target = normLang(lang);
    const key = `${listingId}|${target}`;

    // cache hit
    if (cacheRef.current.has(key)) {
      return cacheRef.current.get(key);
    }

    setLoading(true);
    try {
      const path = `/api/listings/${encodeURIComponent(listingId)}/translate?lang=${encodeURIComponent(target)}`;
      console.log("[translate][client] GET", path);

      const res = await fetchJson(path, { method: "GET" });
      // Il backend deve ritornare: { title, description, lang, originalLang, translated, cached }
      // Normalizziamo con fallback robusti
      const out = {
        title: typeof res?.title === "string" ? res.title : null,
        description: typeof res?.description === "string" ? res.description : null,
        lang: res?.lang || target,
        originalLang: res?.originalLang || null,
        translated: !!res?.translated,
        cached: !!res?.cached,
      };

      cacheRef.current.set(key, out);
      return out;
    } catch (e) {
      console.log("[translate][client] error =", e);
      setError(e?.message || String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { getTranslated, loading, error };
}
