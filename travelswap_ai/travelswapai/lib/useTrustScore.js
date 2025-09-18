// travelswapai/lib/useTrustScore.js
import { useState, useCallback } from 'react';
import { fetchJson } from './backendApi';

/**
 * Normalizza i valori della form nello schema atteso da POST /ai/trustscore
 * Accetta sia un oggetto "listing" già pronto sia i valori grezzi della form.
 */
function normalizeFormToListing(input) {
  if (!input || typeof input !== 'object') {
    return { description: ' ' }; // forza validazione a fallire in modo chiaro
  }

  // Possibili alias dai tuoi step della form
  const {
    // campi generali
    id,
    title,
    titolo,
    description,
    descrizione,
    location,
    localita,
    price,
    prezzo,
    currency,
    valuta,
    holderName,
    nominativo,
    provider,

    // tipologia & azione
    type,
    asset_type,
    tipo,            // "hotel" | "treno"
    cerco_vendo,     // "CERCO" | "VENDO"
    azione,

    // date hotel
    checkIn,
    check_in,
    checkOut,
    check_out,

    // date/luoghi treno
    departAt,
    depart_at,
    arriveAt,
    arrive_at,
    origin,
    destinazione,
    destination,
    partenza,

    // immagini
    images,
    foto,
  } = input;

  const desc =
    (typeof description === 'string' && description) ||
    (typeof descrizione === 'string' && descrizione) ||
    '';

  // tipo/azione
  const tRaw = (asset_type || type || tipo || '').toString().toLowerCase();
  const t =
    tRaw === 'hotel' || tRaw === 'treno' || tRaw === 'train'
      ? (tRaw === 'treno' ? 'train' : tRaw)
      : undefined;

  const action = (cerco_vendo || azione || '').toString().toUpperCase() || undefined;

  // location (per hotel) — dai vari alias
  const loc =
    (typeof location === 'string' && location) ||
    (typeof localita === 'string' && localita) ||
    undefined;

  // Prezzo/currency
  const rawPrice = prezzo ?? price;
  const parsedPrice =
    rawPrice == null
      ? undefined
      : Number(String(rawPrice).replace(',', '.').replace(/[^\d.]/g, ''));
  const curr = (valuta || currency || (parsedPrice != null ? 'EUR' : undefined)) || undefined;

  // Immagini
  const imgs = Array.isArray(images || foto) ? (images || foto) : undefined;

  // Title
  const ttl = title || titolo || undefined;

  // Date: hotel
  const ci = checkIn || check_in;
  const co = checkOut || check_out;

  // Date/luoghi: treno
  const dep = departAt || depart_at;
  const arr = arriveAt || arrive_at;
  const orig = origin || partenza || undefined;
  const dest = destination || destinazione || undefined;

  // Normalizza in ISO YYYY-MM-DD quando possibile
  const toIsoDate = (d) => {
    if (!d) return undefined;
    try {
      // accetta sia Date che stringhe tipo "2025-09-13" o "13/09/2025"
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      const s = String(d).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      // dd/mm/yyyy -> yyyy-mm-dd
      const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
      if (m) {
        const [_, dd, mm, yyyy] = m;
        return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
      const iso = new Date(s);
      if (!isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
    } catch {}
    return undefined;
  };

  let startDate, endDate;
  if (t === 'hotel') {
    startDate = toIsoDate(ci);
    endDate = toIsoDate(co);
  } else if (t === 'train') {
    startDate = toIsoDate(dep);
    endDate = toIsoDate(arr);
  }

  // Oggetto finale nel formato richiesto dal backend
  const out = {
    id: id ?? undefined,
    type: t,                     // 'hotel' | 'train' | undefined
    title: ttl,
    description: desc,           // <-- obbligatorio min 10 char
    location: t === 'hotel' ? loc : undefined,
    origin: t === 'train' ? orig : undefined,
    destination: t === 'train' ? dest : undefined,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
    price: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
    currency: curr,
    holderName: holderName || nominativo || undefined,
    provider: provider || undefined,
    images: imgs,
    action, // opzionale per analytics
  };

  // Ripulisci undefined
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);

  return out;
}

export function useTrustScore() {
  const [loading, setLoading] = useState(false);
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  /**
   * Accetta:
   *  - l'oggetto form completo (quello che usi per salvare l'annuncio)
   *  - oppure direttamente un oggetto listing già nel formato finale
   */
  const evaluate = useCallback(async (formOrListing) => {
    setLoading(true); setError(null);
    try {
      const listing = normalizeFormToListing(formOrListing);

      // Validazione minima client-side (per evitare 400 banali)
      if (!listing.description || listing.description.length < 10) {
        throw new Error('Descrizione troppo corta (min 10 caratteri).');
      }

      const res = await fetchJson('/ai/trustscore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, // in caso fetchJson non lo aggiunga
        body: JSON.stringify({ listing }),
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
