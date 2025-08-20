// euristica base in assenza di AI (nessuna dipendenza esterna)
export function scoreHeuristic(user, listings) {
  const typesPref = new Set(user?.prefs?.types || []);
  const maxPrice = Number(user?.prefs?.maxPrice ?? Infinity);
  const favLoc = (user?.prefs?.location || "").toLowerCase();

  return listings.map(l => {
    let score = 60;

    if (typesPref.size && typesPref.has(l.type)) score += 12;
    if (typeof l.price === "number") {
      if (l.price <= maxPrice) score += 10;
      if (l.price <= maxPrice * 0.6) score += 4;
    }
    const loc = (l.location || "").toLowerCase();
    if (favLoc && loc.includes(favLoc)) score += 8;

    // clamp
    score = Math.max(40, Math.min(98, score));
    const bidirectional = score >= 80; // stima semplicistica
    return { id: l.id, score, bidirectional };
  });
}
