// Partenza e arrivo nella stessa città.
//
// Buco reale trovato rispondendo a una domanda: l'affidabilità non aveva
// alcun concetto di "città". Ogni controllo guardava UN capo alla volta e si
// chiedeva solo "questo posto è raggiungibile in treno?", quindi
// "Roma Termini → Roma Tiburtina" prendeva 100.
//
// E c'era il seguito, peggiore: riconoscendo entrambi i capi come città su
// rotaia, scattava la regola che scarta l'IMPLAUSIBLE_ROUTE dell'AI come
// falso positivo. Il controllo deterministico non guardava, e a quello AI
// veniva tolta la parola.
//
// Il rischio del rimedio è opposto e va difeso con la stessa cura: dire
// "stessa città" su un viaggio vero significa penalizzare un annuncio
// corretto. Da qui i test su Reggio Calabria → Reggio Emilia.
import test from 'node:test';
import assert from 'node:assert/strict';

import { isSameCityRoute, railCityOf, computeHeuristicChecks } from '../src/services/trust/heuristics.js';

test('due stazioni della stessa città sono lo stesso posto', () => {
  assert.equal(isSameCityRoute('Roma Termini', 'Roma Tiburtina'), true);
  assert.equal(isSameCityRoute('Milano Centrale', 'Milano Porta Garibaldi'), true);
  assert.equal(isSameCityRoute('Firenze Santa Maria Novella', 'Firenze Rifredi'), true);
});

test('lo stesso nome scritto in due modi vale come stessa città', () => {
  assert.equal(isSameCityRoute('Roma', 'roma'), true);
  assert.equal(isSameCityRoute('  Milano ', 'MILANO'), true);
});

test('Reggio Calabria e Reggio Emilia restano due città diverse', () => {
  // È il falso positivo che questa funzione poteva creare più facilmente:
  // l'alias 'reggio' esiste apposta per riconoscerle entrambe. Partendo dagli
  // alias invece che dai nomi completi, 1.100 km di viaggio sarebbero
  // diventati "un giro dentro la stessa città".
  assert.equal(isSameCityRoute('Reggio Calabria', 'Reggio Emilia'), false);
  assert.equal(railCityOf('Reggio Calabria'), 'reggio calabria');
  assert.equal(railCityOf('Reggio Emilia'), 'reggio emilia');
});

test('Termini Imerese non è Roma Termini', () => {
  // Stessa famiglia di trabocchetto: 'termini' è un alias di Termini
  // Imerese, e compare dentro "Roma Termini".
  assert.equal(railCityOf('Roma Termini'), 'roma');
  assert.equal(railCityOf('Termini Imerese'), 'termini imerese');
  assert.equal(isSameCityRoute('Termini Imerese', 'Roma Termini'), false);
});

test('un viaggio vero non viene toccato', () => {
  assert.equal(isSameCityRoute('Roma Termini', 'Milano Centrale'), false);
  assert.equal(isSameCityRoute('Napoli', 'Salerno'), false);
});

test('senza uno dei due capi non si conclude niente', () => {
  // Nel dubbio si tace: l'assenza di un dato non è una prova.
  assert.equal(isSameCityRoute('', 'Roma'), false);
  assert.equal(isSameCityRoute('Roma', null), false);
  assert.equal(isSameCityRoute(undefined, undefined), false);
});

test('posti fuori elenco: si confronta il testo, senza inventare geografia', () => {
  // 'ostia' non è nell'allow-list: non possiamo sapere che è area romana, e
  // non lo diciamo. Meglio un avviso mancato che uno sbagliato.
  assert.equal(isSameCityRoute('Ostia', 'Roma'), false);
  assert.equal(isSameCityRoute('Borgo Fantasia', 'Borgo Fantasia'), true);
});

test('il flag c\'è, ed è LEGGERO: fa notare, non brucia l\'annuncio', () => {
  // Quasi sempre è un errore di compilazione, non una truffa — e chi guarda
  // l'annuncio se ne accorge da solo. Un tetto duro (come i 35% di
  // IMPLAUSIBLE_ROUTE) sarebbe sproporzionato.
  const listing = {
    type: 'train',
    title: 'Biglietto',
    description: 'Biglietto del treno, posto a sedere.',
    origin: 'Roma Termini',
    destination: 'Roma Tiburtina',
    price: 30,
    startDate: '2026-09-10T09:00:00Z',
    images: ['x'],
  };
  const out = computeHeuristicChecks(listing, 'it');
  const codes = out.flags.map((f) => f.code);
  assert.ok(codes.includes('SAME_CITY_ROUTE'), `flag attesi, trovati: ${codes}`);
  assert.ok(!codes.includes('IMPLAUSIBLE_ROUTE'), 'non è "non raggiungibile in treno": è un altro problema');
  assert.ok(out.score >= 85, `penalità troppo dura: ${out.score}`);
  assert.ok(out.score < 100, `nessuna penalità applicata: ${out.score}`);
});

test('il suggerimento dice cosa guardare', () => {
  const listing = {
    type: 'train', title: 'x', description: 'treno',
    origin: 'Milano Centrale', destination: 'Milano Rogoredo',
    price: 20, startDate: '2026-09-10T09:00:00Z', images: ['x'],
  };
  const out = computeHeuristicChecks(listing, 'it');
  assert.ok(out.suggestedFixes.some((f) => f.field === 'route'), JSON.stringify(out.suggestedFixes));
});

test('una tratta normale non prende né flag né suggerimento sulla tratta', () => {
  const listing = {
    type: 'train', title: 'x', description: 'treno',
    origin: 'Roma Termini', destination: 'Milano Centrale',
    price: 40, startDate: '2026-09-10T09:00:00Z', images: ['x'],
  };
  const out = computeHeuristicChecks(listing, 'it');
  assert.equal(out.flags.filter((f) => f.code === 'SAME_CITY_ROUTE').length, 0);
  assert.equal(out.suggestedFixes.filter((f) => f.field === 'route').length, 0);
});
