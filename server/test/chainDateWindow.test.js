// Pre-filtro sulla data prima di chiamare l'AI per le catene a 3.
//
// Il numero di chiamate cresce come CERCO x VENDO: con 333 annunci un giro
// è costato 7 centesimi, e la crescita è quadratica — a 1000 annunci non
// sarebbe il triplo, sarebbe circa dieci volte tanto. Mandare al modello un
// candidato con data a tre mesi di distanza costa quanto mandargliene uno
// buono, per farsi dire una cosa che sapevamo già.
//
// Ma un pre-filtro sbagliato è peggio di nessun pre-filtro: toglie catene
// possibili senza che nessuno se ne accorga. Da qui la regola che questi
// test difendono — si scarta solo ciò di cui si è CERTI.
import test from 'node:test';
import assert from 'node:assert/strict';

import { worthScoringByDate, CHAIN_DATE_WINDOW_DAYS } from '../src/ai/chainMatch.js';

const treno = (depart) => ({ type: 'train', depart_at: depart });
const hotel = (checkIn) => ({ type: 'hotel', check_in: checkIn });

test('la finestra predefinita è di 30 giorni, come deciso', () => {
  assert.equal(CHAIN_DATE_WINDOW_DAYS, 30);
});

test('date vicine: si valuta', () => {
  assert.equal(worthScoringByDate(treno('2026-09-10T09:00:00Z'), treno('2026-09-12T18:00:00Z')), true);
});

test('date lontanissime: non si spreca una chiamata', () => {
  assert.equal(worthScoringByDate(treno('2026-09-10T09:00:00Z'), treno('2026-12-20T09:00:00Z')), false);
});

test('il filtro vale in entrambe le direzioni', () => {
  // Prima o dopo non cambia niente: conta la distanza, non il verso.
  const a = treno('2026-09-10T09:00:00Z');
  const b = treno('2026-07-01T09:00:00Z');
  assert.equal(worthScoringByDate(a, b), worthScoringByDate(b, a));
  assert.equal(worthScoringByDate(a, b), false);
});

test('sul bordo della finestra si valuta ancora', () => {
  // Il dubbio va a favore del candidato: 30 giorni esatti passano.
  assert.equal(worthScoringByDate(treno('2026-09-10T09:00:00Z'), treno('2026-10-10T09:00:00Z')), true);
});

test('se una data MANCA il candidato passa, non si scarta al buio', () => {
  // È la regola che rende sicuro un pre-filtro: si toglie solo ciò di cui
  // si è certi. Scartare per un dato che non abbiamo farebbe sparire
  // catene possibili senza lasciare traccia.
  assert.equal(worthScoringByDate(treno(null), treno('2026-09-10T09:00:00Z')), true);
  assert.equal(worthScoringByDate(treno('2026-09-10T09:00:00Z'), treno(undefined)), true);
  assert.equal(worthScoringByDate({}, {}), true);
  assert.equal(worthScoringByDate(treno('non-una-data'), treno('2026-09-10T09:00:00Z')), true);
});

test('per gli hotel guarda il check-in, non la partenza', () => {
  assert.equal(worthScoringByDate(hotel('2026-09-10'), hotel('2026-09-15')), true);
  assert.equal(worthScoringByDate(hotel('2026-09-10'), hotel('2027-01-15')), false);
});

test('la finestra si può stringere o allargare senza toccare il codice', () => {
  const a = treno('2026-09-10T09:00:00Z');
  const b = treno('2026-09-25T09:00:00Z'); // 15 giorni
  assert.equal(worthScoringByDate(a, b, 30), true);
  assert.equal(worthScoringByDate(a, b, 7), false);
});

test('il filtro NON tocca la geografia, ed è deliberato', () => {
  // La vicinanza fra due città è un giudizio, ed è l'unico motivo per cui
  // qui c'è un modello: filtrarla con la mappa statica delle regioni
  // annullerebbe il senso dell'AI. Due tratte lontanissime ma con date
  // vicine devono arrivare comunque al modello.
  const roma = { type: 'train', route_from: 'Roma', route_to: 'Milano', depart_at: '2026-09-10T09:00:00Z' };
  const palermo = { type: 'train', route_from: 'Palermo', route_to: 'Catania', depart_at: '2026-09-11T09:00:00Z' };
  assert.equal(worthScoringByDate(roma, palermo), true);
});
