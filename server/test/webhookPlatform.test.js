// Test per la mappatura body.object -> piattaforma interna (webhookPlatform.js).
// Regola facile da rompere con un refuso, e con effetto grosso se rotta: da
// questa dipende quale token si usa per rispondere e quale `channel` viene
// passato a fbIngest per il gate TrustScore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlatform } from '../src/lib/webhookPlatform.js';

test('resolvePlatform: "page" è Messenger', () => {
  assert.equal(resolvePlatform('page'), 'messenger');
});

test('resolvePlatform: "instagram" è Instagram', () => {
  assert.equal(resolvePlatform('instagram'), 'instagram');
});

test('resolvePlatform: qualsiasi altro valore non è riconosciuto', () => {
  assert.equal(resolvePlatform('whatsapp_business_account'), null);
  assert.equal(resolvePlatform(undefined), null);
  assert.equal(resolvePlatform(''), null);
});
