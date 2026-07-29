// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 8 "Funzionalità collaterali", step 39 "Import da Messenger"):
// l'annuncio creato dal bot passa dallo stesso gate TrustScore dell'app —
// un punteggio troppo basso non deve pubblicare.
//
// fbIngestTrustGate.test.js copre già a fondo evaluateTrustGate() come
// funzione pura (soglia, moderazione, verifica non completata). Qui si
// testa un livello sopra: upsertListingFromFacebook(), l'orchestrazione
// reale dietro il flusso guidato di Messenger, con un TrustScore basso
// mockato — a riprova che il ramo "scartato" ritorna PRIMA di qualunque
// scrittura su Supabase (mai un annuncio a metà pubblicato per errore).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('Import da Messenger: un punteggio troppo basso non pubblica nulla', async () => {
  mock.module('../src/services/trust/computeTrustScore.js', {
    namedExports: {
      computeFullTrustScore: async () => ({ trustScore: 20, moderationFlagged: false, flags: [] }),
    },
  });

  let dbTouched = false;
  const fakeSupabase = {
    from(table) {
      dbTouched = true;
      throw new Error(`upsertListingFromFacebook non deve toccare supabase.from('${table}') quando il gate scarta l'annuncio`);
    },
  };
  mock.module('../src/db.js', { namedExports: { supabase: fakeSupabase } });

  const { upsertListingFromFacebook } = await import('../src/models/fbIngest.js');

  const result = await upsertListingFromFacebook({
    channel: 'facebook:messenger',
    externalId: 'msg-123',
    contactUrl: null,
    rawText: 'Vendo biglietto Roma Milano 45 euro',
    parsed: {
      cerco_vendo: 'VENDO',
      asset_type: 'train',
      from_location: 'Roma',
      to_location: 'Milano',
      depart_at: '2026-08-05T09:00:00',
      arrive_at: '2026-08-05T12:00:00',
      price: '45',
    },
    ownerId: '11111111-1111-4111-8111-111111111111',
  });

  // Stesso "atteso" della checklist manuale, step 39.
  assert.deepEqual(result, { id: null, skipped: true, reason: 'low_trust_score', trustScore: 20 });
  assert.equal(dbTouched, false, "nessuna scrittura su Supabase quando il gate scarta l'annuncio");

  mock.reset();
});
