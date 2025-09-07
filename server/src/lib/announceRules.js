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
export function missingFields(p) {
  const missing = [];

  if (!p.cerco_vendo) missing.push('CERCO/VENDO');

  const t = p.asset_type;
  if (t !== 'train' && t !== 'hotel') missing.push('TIPO (treno/hotel)');

  if (t === 'train') {
    if (!p.depart_at) missing.push('DATA PARTENZA');
    if (!p.arrive_at) missing.push('DATA ARRIVO');
  } else if (t === 'hotel') {
    if (!p.check_in)  missing.push('CHECK-IN');
    if (!p.check_out) missing.push('CHECK-OUT');
  }

  if (p.price == null) missing.push('PREZZO');

  return missing;
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
