// Unisce stato precedente + nuovo parse AI (il nuovo vince se non null)
export function mergeParsed(prev = {}, next = {}) {
  const merged = { ...prev, ...Object.fromEntries(
    Object.entries(next).map(([k, v]) => [k, v ?? prev[k] ?? null])
  )};
  return normalize(merged);
}

function normalize(p) {
  const out = { ...p };

  // CERCO/VENDO normalizzato
  if (out.cerco_vendo) {
    const cv = String(out.cerco_vendo).toUpperCase();
    out.cerco_vendo = (cv === 'CERCO' || cv === 'VENDO') ? cv : null;
  }

  // alias coerenti con fbIngest (che già usi)
  out.depart_at = out.start_date_time || out.start_date || out.depart_at || null;
  out.arrive_at = out.end_date_time   || out.end_date   || out.arrive_at || null;

  out.check_in  = out.check_in  || out.start_date || null;
  out.check_out = out.check_out || out.end_date   || null;

  // prezzo numerico
  if (out.price != null) {
    const n = Number(out.price);
    out.price = Number.isFinite(n) && n >= 0 ? n : null;
  }

  // tipo lower
  if (out.asset_type) out.asset_type = String(out.asset_type).toLowerCase();

  return out;
}

// Requisiti minimi
export function missingFields(s) {
  const miss = [];

  const kind = (s?.asset_type ?? s?.type ?? '').toLowerCase(); // 👈 alias

  if (!s?.cerco_vendo) miss.push('azione (CERCO/VENDO)');
  if (!kind)           miss.push('tipo (treno/hotel)');
  if (s?.price == null) miss.push('prezzo');

  if (kind === 'train' || kind === 'treno') {
    if (!s?.from_location && !s?.route_from) miss.push('partenza (città di origine)');
    if (!s?.to_location   && !s?.route_to)   miss.push('arrivo (città di destinazione)');
    if (!s?.depart_at) miss.push('data di partenza');
  } else if (kind === 'hotel' || kind === 'albergo') {
    if (!s?.hotel_city && !s?.location) miss.push('città (hotel)');
    if (!s?.check_in)  miss.push('check-in');
    if (!s?.check_out) miss.push('check-out');
  }

  return miss;
}


export function nextPromptFor(missing, t) {
  if (missing.includes('CERCO/VENDO')) return 'Stai CERCANDO o VENDENDO? Scrivi "CERCO" oppure "VENDO".';
  if (missing.includes('TIPO (treno/hotel)')) return 'È per treno o hotel? Scrivi "treno" oppure "hotel".';

  if (t === 'train') {
    if (missing.includes('DATA PARTENZA')) return 'Indica la data di PARTENZA (es. 2025-10-15).';
    if (missing.includes('DATA ARRIVO'))   return 'Indica la data di ARRIVO (es. 2025-10-15).';
  }
  if (t === 'hotel') {
    if (missing.includes('CHECK-IN'))  return 'Indica il CHECK-IN (es. 2025-10-20).';
    if (missing.includes('CHECK-OUT')) return 'Indica il CHECK-OUT (es. 2025-10-22).';
  }

  if (missing.includes('PREZZO')) return 'Qual è il prezzo? (numero in euro)';

  return 'Ok, dammi la prossima informazione mancante.';
}
