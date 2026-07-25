// Allow-list delle città servite dal treno (heuristics.js).
//
// Serve a un solo scopo: SOPPRIMERE il flag IMPLAUSIBLE_ROUTE quando l'AI lo
// emette su una tratta che esiste davvero. Da qui i due criteri opposti che
// questi test difendono:
//   - una città vera che NON viene riconosciuta costa un falso positivo, con
//     l'annuncio tappato al 35% di affidabilità (caso reale: Palermo→Mazara);
//   - una località NON servita che viene riconosciuta è molto peggio, perché
//     nasconde una segnalazione corretta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKnownRailCity } from '../src/services/trust/heuristics.js';

test('le città su rotaia sono riconosciute anche in forma breve', () => {
  const brevi = {
    'Mazara': 'Mazara del Vallo',
    'Lamezia': 'Lamezia Terme',
    'Ascoli': 'Ascoli Piceno',
    'Termini': 'Termini Imerese',
    'Giardini': 'Giardini Naxos',
    'Barcellona': 'Barcellona Pozzo di Gotto',
    'Reggio': 'Reggio Calabria / Reggio Emilia',
    'Spezia': 'La Spezia',
    'Aquila': "L'Aquila",
  };
  for (const [breve, estesa] of Object.entries(brevi)) {
    assert.ok(isKnownRailCity(breve), `"${breve}" (${estesa}) non riconosciuta`);
    assert.ok(isKnownRailCity(estesa.split(' / ')[0]), `"${estesa}" non riconosciuta`);
  }
});

test('la forma con apostrofo e quella senza sono equivalenti', () => {
  // normPlace trasforma l'apostrofo in spazio: se saltasse, "L'Aquila" non
  // troverebbe mai la voce 'l aquila' dell'elenco.
  for (const v of ["L'Aquila", "L’Aquila", 'L Aquila', 'l aquila', 'AQUILA']) {
    assert.ok(isKnownRailCity(v), `"${v}" non riconosciuta`);
  }
});

test('le località non servite dal treno restano fuori dall\'allow-list', () => {
  // Se una di queste passasse, il flag IMPLAUSIBLE_ROUTE verrebbe soppresso
  // su una tratta davvero impossibile.
  for (const v of [
    'Pantelleria', 'Lampedusa', 'Capri', 'Ischia', 'Elba', 'Ponza',
    'Olbia', 'Cagliari', 'Villa', 'Porto', 'Nessunluogo', 'Marte',
  ]) {
    assert.ok(!isKnownRailCity(v), `"${v}" NON deve essere nell'allow-list`);
  }
});

test('il match è su parola intera, non su sottostringa', () => {
  // 'roma' non deve far passare 'Romania', 'como' non deve far passare
  // 'Comodoro': sarebbero soppressioni su nomi del tutto diversi.
  for (const v of ['Romania', 'Comodoro Rivadavia', 'Pisania', 'Baripoli']) {
    assert.ok(!isKnownRailCity(v), `"${v}" NON deve essere nell'allow-list`);
  }
  assert.ok(isKnownRailCity('Roma Termini'));
  assert.ok(isKnownRailCity('Milano Centrale'));
});

test('input vuoti o non stringa non sono mai riconosciuti', () => {
  for (const v of ['', '   ', null, undefined, 0, {}, []]) {
    assert.ok(!isKnownRailCity(v), `${JSON.stringify(v)} NON deve essere riconosciuto`);
  }
});
