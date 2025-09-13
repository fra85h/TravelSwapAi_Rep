import { useState, useCallback } from 'react';
import { fetchJson } from './backendApi';

export function useTrustScore() {
  const [loading, setLoading] = useState(false);
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  const evaluate = useCallback(async (listing) => {
    setLoading(true); setError(null);
    try {
      const res = await fetchJson('/ai/trustscore', {
        method: 'POST',
        body: JSON.stringify({ listing })
      });
      setData(res);
      return res;
    } catch (e) {
      setError(e?.message || 'Errore calcolo TrustScore');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, data, error, evaluate };
}
