// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 1 "Pubblicazione annuncio (account A)", step 1+3): account A crea a
// mano un annuncio treno VENDO con tratta reale, data futura e prezzo, poi
// pubblica. Verifica lo stesso esito atteso dalla checklist manuale
// (`select status, trust_score, cerco_vendo, ... from listings ...`), ma
// chiamando la funzione reale dietro "Pubblica" (POST /api/listings →
// createListing) invece di leggere da un database vero: niente Supabase
// live in CI (stessa filosofia di computeTrustScoreDuration.test.js), il
// client viene sostituito con un fake che cattura l'insert.
//
// Fuori scope qui (richiede un DB reale, coperto solo dalla checklist
// manuale): trigger Postgres (enforce_active_listing_cap, whitelist tratte,
// update_listing_trust_score) e il Check AI, che gira lato client separato
// da createListing().
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';

function buildFakeSupabase(capturedInserts) {
  return {
    from(table) {
      return {
        insert(payload) {
          capturedInserts.push({ table, payload });
          return {
            select() {
              return {
                async single() {
                  return {
                    data: { id: 'fake-listing-id-0001', ...payload },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

test('Pubblicazione annuncio (account A): treno VENDO, tratta reale, data futura, prezzo', async () => {
  const capturedInserts = [];
  const fakeSupabase = buildFakeSupabase(capturedInserts);

  mock.module('../src/db.js', {
    namedExports: { supabase: fakeSupabase },
  });
  const { createListing } = await import('../src/models/listings.js');

  const departAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // +7 giorni
  const arriveAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString(); // +3h di viaggio

  const listing = await createListing(ACCOUNT_A, {
    title: 'Roma → Milano, Frecciarossa 9506',
    type: 'train',
    cerco_vendo: 'VENDO',
    route_from: 'Roma',
    route_to: 'Milano',
    depart_at: departAt,
    arrive_at: arriveAt,
    price: 45,
  });

  // Stesso "atteso" della checklist manuale, step 3: status active (nessuno
  // stato esplicito passato → default), cerco_vendo/type/tratta coerenti.
  assert.equal(listing.status, 'active');
  assert.equal(listing.cerco_vendo, 'VENDO');
  assert.equal(listing.type, 'train');
  assert.equal(listing.route_from, 'Roma');
  assert.equal(listing.route_to, 'Milano');
  assert.equal(listing.price, 45);
  assert.equal(listing.user_id, ACCOUNT_A);

  // L'insert deve arrivare sulla tabella giusta, con published_at valorizzato
  // (la checklist non lo controlla via SQL ma è ciò che rende l'annuncio
  // "appena pubblicato" invece che una bozza).
  assert.equal(capturedInserts.length, 1);
  assert.equal(capturedInserts[0].table, 'listings');
  assert.ok(capturedInserts[0].payload.published_at, 'published_at deve essere valorizzato alla pubblicazione');

  mock.reset();
});
