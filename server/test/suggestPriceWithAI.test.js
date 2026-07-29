// Test della nuova funzionalità "Analisi prezzo con AI in creazione"
// (checklist manuale, Parte 8, step 38): suggerisce un prezzo di partenza
// per un annuncio ancora in bozza (nessun listing.id, a differenza di
// checkPriceWithAI che giudica un prezzo su un annuncio già pubblicato).
//
// Nessuna chiave OPENAI_API_KEY in CI: suggestPriceWithAI ricade sempre sul
// ramo "AI non disponibile" (client === null), esattamente come tutte le
// altre funzioni AI di questo repo (computeTrustScoreDuration.test.js,
// score.js) — è il percorso deterministico che deve reggersi da solo
// quando l'AI non risponde, e non richiede una vera chiave per essere
// testato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestPriceWithAI } from '../src/ai/priceCheck.js';

test('suggestPriceWithAI: senza OPENAI_API_KEY ritorna available=false con motivo leggibile', async () => {
  assert.equal(process.env.OPENAI_API_KEY, undefined, 'questo test presume nessuna chiave in CI');

  const draft = {
    type: 'train',
    currency: 'EUR',
    route_from: 'Roma',
    route_to: 'Milano',
    depart_at: '2026-08-05T09:00:00Z',
    arrive_at: '2026-08-05T12:30:00Z',
    title: 'Frecciarossa 9506',
  };

  const result = await suggestPriceWithAI(draft, 'it');

  assert.equal(result.available, false);
  assert.match(result.reason, /OPENAI_API_KEY/i);
});
