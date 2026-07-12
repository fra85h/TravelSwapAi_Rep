// Test per il template deterministico della spiegazione (fase 3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateChainExplanation } from '../src/ai/chainExplain.js';

test('descrive i 3 passaggi del ciclo per annunci treno', () => {
  const text = templateChainExplanation([
    { type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-08-01T09:00:00Z' },
    { type: 'train', route_from: 'Torino', route_to: 'Roma', depart_at: '2026-08-02T09:00:00Z' },
    { type: 'train', route_from: 'Napoli', route_to: 'Bari', depart_at: '2026-08-03T09:00:00Z' },
  ]);
  assert.match(text, /Roma → Milano/);
  assert.match(text, /Torino → Roma/);
  assert.match(text, /Napoli → Bari/);
  assert.match(text, /confermano/);
});

test('descrive annunci hotel via città + check-in', () => {
  const text = templateChainExplanation([
    { type: 'hotel', location: 'Firenze', check_in: '2026-08-01' },
    { type: 'hotel', location: 'Bari', check_in: '2026-08-05' },
    { type: 'hotel', location: 'Torino', check_in: '2026-08-10' },
  ]);
  assert.match(text, /Firenze/);
  assert.match(text, /Bari/);
  assert.match(text, /Torino/);
});

test('non nomina mai persone reali (nessun campo user/name nel testo)', () => {
  const text = templateChainExplanation([
    { type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-08-01T09:00:00Z' },
    { type: 'train', route_from: 'Torino', route_to: 'Roma', depart_at: '2026-08-02T09:00:00Z' },
    { type: 'train', route_from: 'Napoli', route_to: 'Bari', depart_at: '2026-08-03T09:00:00Z' },
  ]);
  assert.doesNotMatch(text, /Anna|Marco|Sofia/i);
});

test('input malformato non esplode, ritorna un testo generico', () => {
  assert.equal(typeof templateChainExplanation([]), 'string');
  assert.equal(typeof templateChainExplanation(null), 'string');
  assert.equal(typeof templateChainExplanation([{ type: 'train' }]), 'string');
});

test('gestisce dati mancanti (data assente) senza rompersi', () => {
  const text = templateChainExplanation([
    { type: 'train', route_from: 'Roma', route_to: 'Milano' },
    { type: 'train', route_from: 'Torino', route_to: 'Roma' },
    { type: 'train', route_from: 'Napoli', route_to: 'Bari' },
  ]);
  assert.match(text, /Roma → Milano/);
});
