// Test del modificatore deterministico budget + prossimità data (Fase 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFit, dateFit, budgetDateFactor } from '../src/ai/score.js';

const cerco = (price, date) => ({ cerco_vendo: 'CERCO', price, depart_at: date });
const vendo = (price, date) => ({ cerco_vendo: 'VENDO', price, depart_at: date });

test('priceFit: VENDO entro il budget del CERCO → 1', () => {
  assert.equal(priceFit(cerco(60), vendo(50)), 1);
  assert.equal(priceFit(cerco(60), vendo(60)), 1); // uguale al budget
});

test('priceFit: VENDO oltre budget → cala; a +50% → 0', () => {
  // budget 60, tolleranza 50% ⇒ 90 azzera. 75 = metà strada ⇒ 0.5
  assert.equal(priceFit(cerco(60), vendo(90)), 0);
  assert.equal(priceFit(cerco(60), vendo(75)), 0.5);
});

test('priceFit: funziona anche con sorgente VENDO e candidato CERCO', () => {
  // il budget è quello del CERCO (candidato): 60; il VENDO (sorgente) costa 75
  assert.equal(priceFit(vendo(75), cerco(60)), 0.5);
});

test('priceFit: neutro (1) se stesso cerco_vendo o prezzo mancante', () => {
  assert.equal(priceFit(cerco(60), cerco(50)), 1);
  assert.equal(priceFit(vendo(60), vendo(50)), 1);
  assert.equal(priceFit(cerco(null), vendo(50)), 1);
  assert.equal(priceFit(cerco(60), vendo(null)), 1);
});

test('dateFit: stessa data → 1, a 7 giorni → 0, a 3.5 → 0.5', () => {
  const d0 = '2026-08-01T10:00:00Z';
  assert.equal(dateFit(cerco(60, d0), vendo(50, d0)), 1);
  assert.equal(dateFit(cerco(60, d0), vendo(50, '2026-08-08T10:00:00Z')), 0);
  assert.equal(dateFit(cerco(60, d0), vendo(50, '2026-08-04T22:00:00Z')), 0.5);
});

test('dateFit: neutro (1) se manca una data', () => {
  assert.equal(dateFit(cerco(60, null), vendo(50, '2026-08-01T10:00:00Z')), 1);
});

test('budgetDateFactor: in budget e stessa data → 1 (nessuna penalità)', () => {
  const d0 = '2026-08-01T10:00:00Z';
  assert.equal(budgetDateFactor(cerco(60, d0), vendo(50, d0)), 1);
});

test('budgetDateFactor: fuori budget e data lontana → 0.5 (dimezzato)', () => {
  const f = cerco(60, '2026-08-01T10:00:00Z');
  const l = vendo(90, '2026-08-08T10:00:00Z'); // priceFit 0, dateFit 0
  // 1 - 0.25*1 - 0.25*1 = 0.5
  assert.equal(budgetDateFactor(f, l), 0.5);
});

test('budgetDateFactor: solo fuori budget (data ok) → 0.75', () => {
  const d0 = '2026-08-01T10:00:00Z';
  assert.equal(budgetDateFactor(cerco(60, d0), vendo(90, d0)), 0.75);
});

test('budgetDateFactor: input mancante → 1', () => {
  assert.equal(budgetDateFactor(null, vendo(50)), 1);
  assert.equal(budgetDateFactor(cerco(60), null), 1);
});
