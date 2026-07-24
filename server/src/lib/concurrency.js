// server/src/lib/concurrency.js
// Esegue una funzione async su ogni elemento con un tetto di parallelismo,
// preservando l'ORDINE dei risultati (results[i] corrisponde a items[i]).
//
// Serve dove più chiamate OpenAI indipendenti venivano fatte in fila (i batch
// di ai/score.js e ai/chainMatch.js): con N batch la latenza era la somma di
// tutte, e con un tetto di 3-4 in volo diventa circa un terzo.
//
// A differenza di runPool in models/matches.js (best-effort: appiattisce i
// risultati e ingoia gli errori), qui gli errori si propagano: i chiamanti
// devono poter distinguere "un batch è fallito" per ricadere sul motore
// deterministico, invece di pubblicare un risultato parziale silenzioso.
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const max = Math.max(1, Math.min(Number(limit) || 1, list.length));

  const results = new Array(list.length);
  let next = 0;

  const workers = Array.from({ length: max }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= list.length) break;
      results[idx] = await fn(list[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}
