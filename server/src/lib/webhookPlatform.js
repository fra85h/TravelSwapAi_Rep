// server/src/lib/webhookPlatform.js
// Mappa il campo "object" del payload webhook Meta alla piattaforma interna.
// Isolata (nessun accesso a Facebook/DB) per bloccare con un test la
// corrispondenza esatta 'page'->messenger / 'instagram'->instagram, facile
// da rompere con un refuso — vedi test/webhookPlatform.test.js.
export function resolvePlatform(objectType) {
  if (objectType === 'page') return 'messenger';
  if (objectType === 'instagram') return 'instagram';
  return null;
}
