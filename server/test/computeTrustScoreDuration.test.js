// Backstop deterministico per la durata assurda di un treno
// (computeFullTrustScore in computeTrustScore.js).
//
// Caso reale osservato in produzione: annuncio Napoli→Caserta (tratta reale
// di ~30-40 minuti) con orari che dichiaravano 22 ore di viaggio — "Nessun
// problema rilevato", 100% di affidabilità. Il codice esistente sapeva solo
// RIMUOVERE il flag IMPLAUSIBLE_DURATION se l'AI lo dava per errore (durata
// normale giudicata "assurda"), non aggiungerlo se l'AI semplicemente non se
// ne accorgeva: l'unico giudice era il modello, non deterministico.
//
// Nessuna chiave OPENAI_API_KEY in CI: aiTrustReview e moderateListing
// ricadono entrambi sul fallback deterministico (AI_DISABLED, nessuna
// chiamata di rete), quindi computeFullTrustScore è testabile end-to-end
// senza mock — è esattamente il percorso che deve reggersi da solo quando
// l'AI non interviene affatto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFullTrustScore } from '../src/services/trust/computeTrustScore.js';

function flagCodes(result) {
  return (result.flags || []).map((f) => String(f?.code || '').toUpperCase());
}

test('22 ore Napoli→Caserta: il flag scatta anche senza che l\'AI lo segnali', async () => {
  const listing = {
    title: 'Vendo biglietto treno Napoli-Caserta',
    type: 'train',
    origin: 'Napoli',
    destination: 'Caserta',
    startDate: '2026-08-05T00:00:00',
    endDate: '2026-08-05T22:21:00',
    price: 10,
  };
  const result = await computeFullTrustScore(listing, 'it');
  assert.ok(flagCodes(result).includes('IMPLAUSIBLE_DURATION'), 'deve comparire il flag');
  // Non si verifica qui il tetto sul trustScore: senza OPENAI_API_KEY in CI,
  // aiAvailable è false e verificationPending forza trustScore a null PRIMA
  // che il tetto abbia un punteggio su cui applicarsi (è un altro comportamento,
  // testato altrove) — il tetto IMPLAUSIBLE_DURATION->45 stesso è verificato
  // in trustCaps.test.js, indipendente dalla disponibilità dell'AI.
});

test('una durata realistica sulla stessa tratta non genera il flag', async () => {
  const listing = {
    title: 'Vendo biglietto treno Napoli-Caserta',
    type: 'train',
    origin: 'Napoli',
    destination: 'Caserta',
    startDate: '2026-08-05T08:00:00',
    endDate: '2026-08-05T08:35:00',
    price: 10,
  };
  const result = await computeFullTrustScore(listing, 'it');
  assert.ok(!flagCodes(result).includes('IMPLAUSIBLE_DURATION'), 'nessun flag su una durata normale');
});

test('un hotel non entra nella logica della durata del treno', async () => {
  const listing = {
    title: 'Camera doppia',
    type: 'hotel',
    location: 'Napoli',
    startDate: '2026-08-05',
    endDate: '2026-08-07',
    price: 80,
  };
  const result = await computeFullTrustScore(listing, 'it');
  assert.ok(!flagCodes(result).includes('IMPLAUSIBLE_DURATION'));
});
