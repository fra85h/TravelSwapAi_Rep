// Tetti al TrustScore (applyTrustCaps in computeTrustScore.js).
//
// La media pesata 45/45/10 diluisce i problemi oggettivi: senza tetti una
// tratta impossibile finirebbe all'83% e un annuncio mai verificato dall'AI al
// 100%. Questi test fissano la regola più importante di tutte: un punteggio
// con un problema noto, o senza la verifica AI, non deve MAI cadere nella
// fascia verde di TrustScoreBadge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTrustCaps, TRUST_CAPS, MODERATION_CAP, AI_UNAVAILABLE_CAP,
} from '../src/services/trust/computeTrustScore.js';

// Soglie di colore di components/TrustScoreBadge.js
const VERDE = 85;
const GIALLO = 70;

test('senza flag e con AI disponibile il punteggio non viene toccato', () => {
  assert.equal(applyTrustCaps(100, { aiAvailable: true }), 100);
  assert.equal(applyTrustCaps(72, { aiAvailable: true }), 72);
  assert.equal(applyTrustCaps(0, { aiAvailable: true }), 0);
});

test('verifica AI non riuscita: il 100% diventa un punteggio non rassicurante', () => {
  // Il caso che ha aperto la correzione: OpenAI risponde 429, aiTrust.js fa
  // ripiegare textScore sulle euristiche, la media restituisce 100 e l'utente
  // vedeva "Affidabilità: 100%" in verde SOPRA il riquadro rosso "Verifica AI
  // non disponibile".
  const s = applyTrustCaps(100, { aiAvailable: false });
  assert.equal(s, AI_UNAVAILABLE_CAP);
  assert.ok(s < GIALLO, `senza verifica AI non si può restare sopra ${GIALLO}: ${s}`);
});

test('il tetto non ALZA mai un punteggio già basso', () => {
  // Un annuncio scadente che per giunta non è stato verificato resta scadente:
  // i tetti sono un massimo, non un valore da assegnare.
  assert.equal(applyTrustCaps(20, { aiAvailable: false }), 20);
  assert.equal(applyTrustCaps(10, { moderationFlagged: true }), 10);
  assert.equal(applyTrustCaps(5, { flagCodes: ['IMPLAUSIBLE_ROUTE'] }), 5);
});

test('ogni flag grave ha il suo tetto e nessuno resta nella fascia verde', () => {
  for (const [code, cap] of Object.entries(TRUST_CAPS)) {
    const s = applyTrustCaps(100, { flagCodes: [code] });
    assert.equal(s, cap, `tetto sbagliato per ${code}`);
    assert.ok(s < VERDE, `${code} non deve poter apparire in verde: ${s}`);
  }
});

test('il codice del flag è confrontato senza distinzione di maiuscole', () => {
  assert.equal(applyTrustCaps(100, { flagCodes: ['implausible_route'] }), TRUST_CAPS.IMPLAUSIBLE_ROUTE);
  assert.equal(applyTrustCaps(100, { flagCodes: ['Irrelevant_Images'] }), TRUST_CAPS.IRRELEVANT_IMAGES);
});

test('con più problemi insieme vince il tetto più basso', () => {
  const s = applyTrustCaps(100, {
    flagCodes: ['IRRELEVANT_IMAGES', 'IMPLAUSIBLE_ROUTE', 'PRICE_OUTLIER'],
    aiAvailable: false,
  });
  assert.equal(s, TRUST_CAPS.IMPLAUSIBLE_ROUTE, 'deve prevalere il più severo');
});

test('la moderazione batte qualunque altro tetto', () => {
  const s = applyTrustCaps(100, {
    flagCodes: ['IMPLAUSIBLE_ROUTE'],
    moderationFlagged: true,
    aiAvailable: false,
  });
  assert.equal(s, MODERATION_CAP);
});

test('flag sconosciuti non cambiano nulla', () => {
  // Un flag nuovo, o informativo come NO_IMAGES, non deve tappare il punteggio
  // per sbaglio: l'assenza di foto è già gestita altrove come suggerimento.
  assert.equal(applyTrustCaps(92, { flagCodes: ['NO_IMAGES', 'QUALCOSA_DI_NUOVO'] }), 92);
});

test('input non numerici o fuori scala non producono punteggi assurdi', () => {
  assert.equal(applyTrustCaps(NaN, {}), 0);
  assert.equal(applyTrustCaps(undefined, {}), 0);
  assert.equal(applyTrustCaps('abc', {}), 0);
  assert.equal(applyTrustCaps(140, {}), 100);
  assert.equal(applyTrustCaps(-30, {}), 0);
});

test('senza contesto si assume il caso ottimista (AI disponibile, nessun flag)', () => {
  // Chi chiama senza secondo argomento non deve ritrovarsi il punteggio
  // tappato a sorpresa.
  assert.equal(applyTrustCaps(88), 88);
});
