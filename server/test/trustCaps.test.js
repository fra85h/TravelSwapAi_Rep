// Tetti al TrustScore (applyTrustCaps in computeTrustScore.js).
//
// La media pesata 45/45/10 diluisce i problemi oggettivi: senza tetti una
// tratta impossibile finirebbe all'83%. Questi test fissano la regola più
// importante: un punteggio con un problema NOTO non deve mai cadere nella
// fascia verde di TrustScoreBadge.
//
// Il caso "verifica non riuscita" NON sta più qui: non produce un punteggio
// da tappare, produce l'assenza di punteggio (vedi verificationPending).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTrustCaps, TRUST_CAPS, MODERATION_CAP,
} from '../src/services/trust/computeTrustScore.js';

// Soglia del verde in components/TrustScoreBadge.js
const VERDE = 85;

test('senza flag il punteggio non viene toccato', () => {
  assert.equal(applyTrustCaps(100), 100);
  assert.equal(applyTrustCaps(72), 72);
  assert.equal(applyTrustCaps(0), 0);
});

test('la verifica non riuscita NON è più un tetto: qui non arriva proprio', () => {
  // Storia di questo test, in due giri.
  //
  // Prima: con l'AI irraggiungibile il punteggio finiva a 100 e verde, perché
  // aiTrust faceva ripiegare textScore sulle euristiche. Sbagliato.
  // Poi: tetto a 55. Sbagliato anche quello — un numero basso dice "abbiamo
  // controllato e non convince", mentre non si era controllato niente, e
  // quel 55 stava per giunta SOPRA la soglia del gate (50).
  //
  // Ora quel caso non produce nessun punteggio (verificationPending in
  // computeFullTrustScore), quindi applyTrustCaps non lo vede mai: qui si
  // fissa solo che nessun parametro residuo possa reintrodurre un tetto.
  assert.equal(applyTrustCaps(100, { aiAvailable: false }), 100,
    'aiAvailable non deve più influenzare i tetti');
  assert.equal(applyTrustCaps(88, { verificationPending: true }), 88);
});

test('il tetto non ALZA mai un punteggio già basso', () => {
  // Un annuncio scadente che per giunta non è stato verificato resta scadente:
  // i tetti sono un massimo, non un valore da assegnare.
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
  });
  assert.equal(s, TRUST_CAPS.IMPLAUSIBLE_ROUTE, 'deve prevalere il più severo');
});

test('la moderazione batte qualunque altro tetto', () => {
  const s = applyTrustCaps(100, {
    flagCodes: ['IMPLAUSIBLE_ROUTE'],
    moderationFlagged: true,
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

test('senza contesto non si tappa niente a sorpresa', () => {
  assert.equal(applyTrustCaps(88), 88);
});
