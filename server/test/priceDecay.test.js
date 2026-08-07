// Test del "prezzo dinamico" (server/src/models/priceDecay.js,
// server/src/routes/priceDecay.js): decadimento automatico del prezzo
// verso price_floor negli ultimi PRICE_DECAY_WINDOW_DAYS giorni prima
// dell'evento (depart_at/check_in). Stesso approccio degli altri test di
// route cron-only: si chiama l'handler finale con un req/res fittizio e
// un mock completo di Supabase, nessuna chiamata di rete vera.
//
// Ordine/struttura IMPORTANTI: un solo test importa dinamicamente
// src/routes/priceDecay.js (quindi src/models/priceDecay.js, quindi
// src/db.js). Con un modulo intermedio (models/) tra la route e db.js, un
// SECONDO mock.module('../src/db.js', ...) seguito da un secondo
// `await import(...)` dello stesso file non sostituisce più il binding già
// risolto la prima volta (a differenza del caso a un solo livello, es.
// routes/notify.js che importa db.js direttamente): il modulo intermedio
// resta agganciato al mock della prima chiamata. Per questo entrambi gli
// scenari (prezzo che scende / prezzo già al minimo) sono in un SOLO test,
// con due annunci diversi nello stesso batch — riflette anche meglio come
// gira davvero il cron, su tanti annunci insieme.
//
// I test "puri" su computeTargetPrice vanno DOPO: usano lo stesso modulo,
// già in cache a quel punto, ma non toccano mai supabase quindi non importa
// quale mock fosse attivo quando è stato caricato.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const DAY = 24 * 60 * 60 * 1000;

function lastHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route non trovata: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

// ---- POST /price-decay/recompute: mock completo di Supabase ----

test('POST /price-decay/recompute: aggiorna solo l\'annuncio che deve scendere, l\'altro (già al minimo) resta intatto', async () => {
  mock.module('../src/lib/push.js', {
    namedExports: {
      sendExpoPush: async (userIds, payload) => { pushInviati.push({ userIds, payload }); return { sent: 0 }; },
    },
  });

  const now = Date.now();
  const updates = [];
  const notifications = [];
  const savedQueries = [];
  const pushInviati = [];

  mock.module('../src/db.js', {
    namedExports: {
      supabase: {
        from(table) {
          if (table === 'listings') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    not: () => ({
                      not: () => ({
                        then: (resolve) => resolve({
                          data: [
                            {
                              id: 'listing-1',
                              user_id: 'seller-1',
                              title: 'Roma → Milano',
                              price: 100,
                              list_price: 100,
                              price_floor: 40,
                              depart_at: new Date(now + 3.5 * DAY).toISOString(),
                              check_in: null,
                              status: 'active',
                            },
                            {
                              // Già sceso al floor in un giro precedente
                              // (annuncio ormai al giorno dell'evento): nessun
                              // ulteriore taglio possibile.
                              id: 'listing-2',
                              user_id: 'seller-2',
                              title: 'Hotel Napoli',
                              price: 40,
                              list_price: 100,
                              price_floor: 40,
                              depart_at: null,
                              check_in: new Date(now).toISOString(),
                              status: 'active',
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
              update: (patch) => ({
                eq: (col1, id) => ({
                  eq: () => {
                    updates.push({ id, patch });
                    return { then: (resolve) => resolve({ error: null }) };
                  },
                }),
              }),
            };
          }
          if (table === 'saved_listings') {
            return {
              select: () => ({
                in: async (col, ids) => {
                  savedQueries.push({ col, ids });
                  return {
                    data: [
                      // Due persone diverse hanno salvato listing-1...
                      { user_id: 'anna', listing_id: 'listing-1' },
                      { user_id: 'bruno', listing_id: 'listing-1' },
                      // ...e fra queste c'e anche il venditore, che NON deve
                      // ricevere l'avviso: la sua notifica ce l'ha gia.
                      { user_id: 'seller-1', listing_id: 'listing-1' },
                    ],
                    error: null,
                  };
                },
              }),
            };
          }
          if (table === 'notifications') {
            return { insert: async (row) => { notifications.push(row); return { error: null }; } };
          }
          throw new Error(`tabella non mockata: ${table}`);
        },
      },
    },
  });

  const { priceDecayRouter } = await import('../src/routes/priceDecay.js');
  const handler = lastHandler(priceDecayRouter, 'post', '/recompute');

  process.env.CHAIN_CRON_SECRET = 'il-vero-secret';
  const req = {};
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.body.checked, 2);
  assert.equal(res.body.updated, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'listing-1');
  assert.equal(updates[0].patch.price, 70); // metà finestra di 7gg: 100 - (100-40)*0.5 = 70
  // --- notifica al venditore: invariata ---
  const alVenditore = notifications.filter((n) => !Array.isArray(n));
  assert.equal(alVenditore.length, 1);
  assert.equal(alVenditore[0].user_id, 'seller-1');
  assert.equal(alVenditore[0].type, 'listing_price_dropped');
  assert.equal(alVenditore[0].data.price, 70);

  // --- il prezzo e la memoria anti-spam vanno a DB nella STESSA update ---
  // Se fossero due scritture separate esisterebbe un istante in cui il
  // prezzo e sceso ma il riferimento e ancora quello vecchio: il giro
  // successivo del cron rimanderebbe la stessa notifica.
  assert.equal(updates[0].patch.savers_notified_price, 70);

  // --- fan-out a chi ha salvato l'annuncio ---
  // Una sola query per tutti gli annunci del giro, non una per annuncio.
  assert.equal(savedQueries.length, 1);
  assert.deepEqual(savedQueries[0].ids, ['listing-1']);

  const aiSalvati = notifications.filter(Array.isArray).flat();
  assert.equal(aiSalvati.length, 2, 'anna e bruno, non il venditore');
  assert.deepEqual(aiSalvati.map((n) => n.user_id).sort(), ['anna', 'bruno']);
  for (const n of aiSalvati) {
    assert.equal(n.type, 'saved_listing_price_dropped');
    assert.equal(n.data.price, 70);
    assert.equal(n.data.previousPrice, 100);
    // listingId porta il tocco sulla notifica dritto all'annuncio.
    assert.equal(n.data.listingId, 'listing-1');
  }

  // Il venditore riceve UNA notifica sola, la sua: due avvisi per lo stesso
  // evento sono il modo piu rapido per farle spegnere entrambe.
  assert.equal(notifications.flat().filter((n) => n.user_id === 'seller-1').length, 1);

  // Push: un solo invio per annuncio, con dentro tutti i destinatari.
  const pushAiSalvati = pushInviati.filter((p) => Array.isArray(p.userIds));
  assert.equal(pushAiSalvati.length, 1);
  assert.deepEqual([...pushAiSalvati[0].userIds].sort(), ['anna', 'bruno']);

  assert.equal(res.body.savedNotified, 2);

  mock.reset();
});

// ---- computeTargetPrice: funzione pura. Dopo i test sopra (vedi commento
// in cima al file sul perché l'ordine conta), il modulo è già in cache con
// mock.reset() applicato: qui basta l'import dinamico, la funzione non
// tocca comunque mai supabase. ----

test('computeTargetPrice: fuori dalla finestra, resta a list_price (nessuno sconto)', async () => {
  const { computeTargetPrice } = await import('../src/models/priceDecay.js');
  const now = Date.now();
  const listing = {
    depart_at: new Date(now + 20 * DAY).toISOString(),
    list_price: 100,
    price_floor: 40,
  };
  assert.equal(computeTargetPrice(listing, now), 100);
});

test('computeTargetPrice: a metà della finestra di 7 giorni, sconto a metà strada', async () => {
  const { computeTargetPrice } = await import('../src/models/priceDecay.js');
  const now = Date.now();
  const listing = {
    depart_at: new Date(now + 3.5 * DAY).toISOString(),
    list_price: 100,
    price_floor: 40,
  };
  // progress = (7 - 3.5) / 7 = 0.5 → target = 100 - (100-40)*0.5 = 70
  assert.equal(computeTargetPrice(listing, now), 70);
});

test('computeTargetPrice: evento già arrivato/passato, clampa a price_floor', async () => {
  const { computeTargetPrice } = await import('../src/models/priceDecay.js');
  const now = Date.now();
  const listing = {
    depart_at: new Date(now - DAY).toISOString(),
    list_price: 100,
    price_floor: 40,
  };
  assert.equal(computeTargetPrice(listing, now), 40);
});

test('computeTargetPrice: usa check_in per gli hotel quando manca depart_at', async () => {
  const { computeTargetPrice } = await import('../src/models/priceDecay.js');
  const now = Date.now();
  const listing = {
    check_in: new Date(now).toISOString(), // giorno stesso → fine finestra
    list_price: 100,
    price_floor: 40,
  };
  assert.equal(computeTargetPrice(listing, now), 40);
});

test('computeTargetPrice: senza list_price o price_floor, ritorna null (nessun dato per calcolare)', async () => {
  const { computeTargetPrice } = await import('../src/models/priceDecay.js');
  const now = Date.now();
  assert.equal(computeTargetPrice({ depart_at: new Date(now + DAY).toISOString(), list_price: null, price_floor: 40 }, now), null);
  assert.equal(computeTargetPrice({ depart_at: new Date(now + DAY).toISOString(), list_price: 100, price_floor: null }, now), null);
});

test('computeTargetPrice: senza nessuna data evento, ritorna null', async () => {
  const { computeTargetPrice } = await import('../src/models/priceDecay.js');
  assert.equal(computeTargetPrice({ list_price: 100, price_floor: 40 }), null);
});

// ---- deveAvvisareChiHaSalvato: la regola anti-spam ----
//
// È la parte che decide se una persona riceve o no una notifica, quindi va
// provata da sola. Il cron gira spesso e la curva scende a piccoli passi:
// senza soglia si manderebbe un avviso per ogni centesimo, e il primo
// effetto sarebbe che la gente le disattiva tutte.

test('avviso ai preferiti: la prima volta il riferimento è il prezzo di partenza', async () => {
  const { deveAvvisareChiHaSalvato } = await import('../src/models/priceDecay.js');
  const listing = { list_price: 100, savers_notified_price: null, price: 100 };
  assert.equal(deveAvvisareChiHaSalvato(listing, 96), false, '4% non basta');
  assert.equal(deveAvvisareChiHaSalvato(listing, 95), true, '5% esatto basta');
  assert.equal(deveAvvisareChiHaSalvato(listing, 70), true);
});

test('avviso ai preferiti: dopo il primo, il riferimento è quello già annunciato', async () => {
  const { deveAvvisareChiHaSalvato } = await import('../src/models/priceDecay.js');
  // Già detto "ora a 95". Un altro centesimo non è una notizia.
  const listing = { list_price: 100, savers_notified_price: 95, price: 95 };
  assert.equal(deveAvvisareChiHaSalvato(listing, 94.99), false);
  assert.equal(deveAvvisareChiHaSalvato(listing, 91), false, '4,2% dall\'ultimo avviso');
  assert.equal(deveAvvisareChiHaSalvato(listing, 90.25), true, '5% dall\'ultimo avviso');
});

test('avviso ai preferiti: se il venditore rialza il prezzo si riparte da capo', async () => {
  const { deveAvvisareChiHaSalvato } = await import('../src/models/priceDecay.js');
  // Avevamo annunciato 50; poi il venditore ha rialzato a 200 e ri-ancorato.
  // Senza il ricalcolo del riferimento, la soglia resterebbe 47,50 — un
  // valore che il prezzo non tocca più — e quelle notifiche non
  // ripartirebbero mai.
  const listing = { list_price: 200, savers_notified_price: 50, price: 200 };
  assert.equal(deveAvvisareChiHaSalvato(listing, 190), true, '5% dai 200 nuovi');
  assert.equal(deveAvvisareChiHaSalvato(listing, 196), false);
});

test('avviso ai preferiti: senza dati per decidere, non si avvisa', async () => {
  const { deveAvvisareChiHaSalvato } = await import('../src/models/priceDecay.js');
  // Tacere è il fallimento sicuro: una notifica sbagliata la si legge, una
  // non mandata al massimo si recupera al giro dopo.
  assert.equal(deveAvvisareChiHaSalvato({ list_price: null, savers_notified_price: null }, 50), false);
  assert.equal(deveAvvisareChiHaSalvato({ list_price: 0, savers_notified_price: null }, 0), false);
  assert.equal(deveAvvisareChiHaSalvato({ list_price: 100 }, NaN), false);
  assert.equal(deveAvvisareChiHaSalvato(null, 50), false);
});

test('avviso ai preferiti: la soglia è configurabile', async () => {
  const { deveAvvisareChiHaSalvato } = await import('../src/models/priceDecay.js');
  const listing = { list_price: 100, savers_notified_price: null, price: 100 };
  assert.equal(deveAvvisareChiHaSalvato(listing, 99, 0.10), false);
  assert.equal(deveAvvisareChiHaSalvato(listing, 90, 0.10), true);
});
