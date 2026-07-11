// Test per le regole del flow di pubblicazione via Messenger
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeParsed, missingFields, nextPromptFor } from '../src/lib/announceRules.js';

test('mergeParsed: il nuovo parse vince solo se non null', () => {
  const prev = { cerco_vendo: 'CERCO', price: 40 };
  const next = { cerco_vendo: null, price: 55, asset_type: 'TRAIN' };
  const out = mergeParsed(prev, next);
  assert.equal(out.cerco_vendo, 'CERCO'); // null non sovrascrive
  assert.equal(out.price, 55);
  assert.equal(out.asset_type, 'train'); // normalizzato lowercase
});

test('mergeParsed: normalizza CERCO/VENDO e scarta valori non validi', () => {
  assert.equal(mergeParsed({}, { cerco_vendo: 'vendo' }).cerco_vendo, 'VENDO');
  assert.equal(mergeParsed({}, { cerco_vendo: 'boh' }).cerco_vendo, null);
});

test('mergeParsed: alias date coerenti con fbIngest', () => {
  const out = mergeParsed({}, { start_date: '2026-10-01', end_date: '2026-10-03' });
  assert.equal(out.depart_at, '2026-10-01');
  assert.equal(out.arrive_at, '2026-10-03');
  assert.equal(out.check_in, '2026-10-01');
  assert.equal(out.check_out, '2026-10-03');
});

test('mergeParsed: prezzo numerico valido, negativo scartato', () => {
  assert.equal(mergeParsed({}, { price: '45' }).price, 45);
  assert.equal(mergeParsed({}, { price: -3 }).price, null);
});

test('missingFields: treno completo non segnala mancanze', () => {
  const s = {
    cerco_vendo: 'VENDO', asset_type: 'train', price: 45,
    from_location: 'Roma', to_location: 'Milano', depart_at: '2026-10-01',
  };
  assert.deepEqual(missingFields(s), []);
});

test('missingFields: hotel senza date segnala check-in e check-out', () => {
  const s = { cerco_vendo: 'CERCO', asset_type: 'hotel', price: 100, location: 'Firenze' };
  const miss = missingFields(s);
  assert.ok(miss.includes('check-in'));
  assert.ok(miss.includes('check-out'));
});

test('missingFields: sessione vuota chiede azione, tipo e prezzo', () => {
  const miss = missingFields({});
  assert.ok(miss.includes('azione (CERCO/VENDO)'));
  assert.ok(miss.includes('tipo (treno/hotel)'));
  assert.ok(miss.includes('prezzo'));
});

// Regressione: le etichette di nextPromptFor devono coincidere con missingFields
// (prima del fix rispondeva sempre col prompt generico)
test('nextPromptFor: risponde con prompt specifici per ogni campo mancante', () => {
  const generic = 'Ok, dammi la prossima informazione mancante.';

  assert.notEqual(nextPromptFor(missingFields({}), null), generic);

  const trainNoDate = { cerco_vendo: 'VENDO', asset_type: 'train', price: 45, from_location: 'Roma', to_location: 'Milano' };
  assert.notEqual(nextPromptFor(missingFields(trainNoDate), 'train'), generic);

  const hotelNoCheckin = { cerco_vendo: 'CERCO', asset_type: 'hotel', price: 100, location: 'Firenze', check_out: '2026-10-03' };
  assert.notEqual(nextPromptFor(missingFields(hotelNoCheckin), 'hotel'), generic);

  const noPrice = { cerco_vendo: 'VENDO', asset_type: 'train', from_location: 'Roma', to_location: 'Milano', depart_at: '2026-10-01' };
  assert.equal(nextPromptFor(missingFields(noPrice), 'train'), 'Qual è il prezzo? (numero in euro)');
});
