// Test del modificatore deterministico budget + prossimità data (Fase 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFit, dateFit, budgetDateFactor, adjustedScore } from '../src/ai/score.js';

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

test('dateFit: tolleranza entro 1 giorno, poi calo lineare (finestra 14)', () => {
  const d0 = '2026-08-01T10:00:00Z';
  assert.equal(dateFit(cerco(60, d0), vendo(50, d0)), 1);                          // stessa data
  assert.equal(dateFit(cerco(60, d0), vendo(50, '2026-08-02T10:00:00Z')), 1);      // 1 giorno → tolleranza piena
  assert.equal(dateFit(cerco(60, d0), vendo(50, '2026-08-09T10:00:00Z')), 0.5);    // 8 giorni → 1-(8-1)/14
  assert.equal(dateFit(cerco(60, d0), vendo(50, '2026-08-16T10:00:00Z')), 0);      // 15 giorni → 0
});

test('dateFit: uno scarto di 1 giorno NON penalizza (il caso 79%→0%)', () => {
  const d0 = '2026-08-01T10:00:00Z';
  assert.equal(dateFit(cerco(60, d0), vendo(60, '2026-08-02T10:00:00Z')), 1);
});

test('dateFit: neutro (1) se manca una data', () => {
  assert.equal(dateFit(cerco(60, null), vendo(50, '2026-08-01T10:00:00Z')), 1);
});

test('budgetDateFactor: in budget e stessa data → 1 (nessuna penalità)', () => {
  const d0 = '2026-08-01T10:00:00Z';
  assert.equal(budgetDateFactor(cerco(60, d0), vendo(50, d0)), 1);
});

test('budgetDateFactor: fuori budget e data molto lontana → 0.5 (dimezzato)', () => {
  const f = cerco(60, '2026-08-01T10:00:00Z');
  const l = vendo(90, '2026-08-16T10:00:00Z'); // priceFit 0, dateFit 0 (15 giorni)
  // 1 - 0.25*1 - 0.25*1 = 0.5 → il match non scende mai sotto la metà
  assert.equal(budgetDateFactor(f, l), 0.5);
});

test('budgetDateFactor: match strutturale a 1 giorno di distanza resta pieno', () => {
  const f = cerco(60, '2026-08-01T10:00:00Z');
  const l = vendo(60, '2026-08-02T10:00:00Z'); // in budget, 1 giorno → nessuna penalità
  assert.equal(budgetDateFactor(f, l), 1);
});

test('budgetDateFactor: solo fuori budget (data ok) → 0.75', () => {
  const d0 = '2026-08-01T10:00:00Z';
  assert.equal(budgetDateFactor(cerco(60, d0), vendo(90, d0)), 0.75);
});

test('budgetDateFactor: input mancante → 1', () => {
  assert.equal(budgetDateFactor(null, vendo(50)), 1);
  assert.equal(budgetDateFactor(cerco(60), null), 1);
});

test('adjustedScore: sempre INTERO (la colonna matches.score è integer)', () => {
  const d0 = '2026-08-01T10:00:00Z';
  // 90 * 0.75 = 67.5 → 68 (intero, mai frazionario come "48.172")
  const s1 = adjustedScore(90, cerco(60, d0), vendo(90, d0)); // solo fuori budget
  assert.equal(Number.isInteger(s1), true);
  assert.equal(s1, 68);
  // caso che generava il bug: base frazionaria per il fattore
  const s2 = adjustedScore(64, cerco(60, d0), vendo(75, '2026-08-04T22:00:00Z'));
  assert.equal(Number.isInteger(s2), true);
});

test('adjustedScore: in budget e stessa data → punteggio base invariato', () => {
  const d0 = '2026-08-01T10:00:00Z';
  assert.equal(adjustedScore(90, cerco(60, d0), vendo(50, d0)), 90);
});
