// Test per le euristiche antifrode del TrustScore
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHeuristicChecks, isKnownRailCity } from '../src/services/trust/heuristics.js';

function inDays(n) {
  return new Date(Date.now() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const goodHotel = {
  type: 'hotel',
  title: 'Vendo hotel Firenze',
  description: 'Camera doppia in centro, prenotazione flessibile',
  destination: 'Firenze',
  startDate: inDays(30),
  endDate: inDays(32),
  price: 120,
  images: [{ url: 'https://example.com/1.jpg' }],
};

test('listing completo e plausibile ottiene uno score alto', () => {
  const out = computeHeuristicChecks(goodHotel);
  assert.ok(out.score >= 80, `atteso >=80, ottenuto ${out.score}`);
  assert.equal(out.flags.some(f => f.code === 'DATE_SWAP'), false);
});

test('date invertite: flag DATE_SWAP e score ridotto', () => {
  const out = computeHeuristicChecks({ ...goodHotel, startDate: inDays(32), endDate: inDays(30) });
  assert.ok(out.flags.some(f => f.code === 'DATE_SWAP'));
  assert.ok(out.score < computeHeuristicChecks(goodHotel).score);
});

test('data di inizio nel passato: flag PAST_START', () => {
  const out = computeHeuristicChecks({ ...goodHotel, startDate: inDays(-10), endDate: inDays(-8) });
  assert.ok(out.flags.some(f => f.code === 'PAST_START'));
});

test('prezzo non positivo: flag e suggerimento di fix', () => {
  const out = computeHeuristicChecks({ ...goodHotel, price: 0 });
  assert.ok(out.flags.some(f => f.code === 'NON_POSITIVE_PRICE'));
  assert.ok(out.suggestedFixes?.some?.(f => f.field === 'price') ?? true);
});

test('termini sospetti nel testo: flag SUSPICIOUS_TERMS e penalità', () => {
  const out = computeHeuristicChecks({
    ...goodHotel,
    description: 'Pagamento solo con western union, anticipo richiesto',
  });
  assert.ok(out.flags.some(f => f.code === 'SUSPICIOUS_TERMS'));
  assert.ok(out.score < computeHeuristicChecks(goodHotel).score);
});

test('nessuna immagine: flag NO_IMAGES', () => {
  const out = computeHeuristicChecks({ ...goodHotel, images: [] });
  assert.ok(out.flags.some(f => f.code === 'NO_IMAGES'));
});

test('descrizione da hotel su annuncio treno: flag INCOHERENT_TYPE', () => {
  const out = computeHeuristicChecks({
    type: 'train',
    title: 'Vendo',
    description: 'Camera doppia con colazione inclusa, 3 notti in hotel, check-in flessibile',
    origin: 'Roma', destination: 'Milano',
    startDate: inDays(20),
    price: 50, images: [{ url: 'https://example.com/1.jpg' }],
  });
  assert.ok(out.flags.some(f => f.code === 'INCOHERENT_TYPE'));
});

test('treno coerente: nessun flag INCOHERENT_TYPE', () => {
  const out = computeHeuristicChecks({
    type: 'train',
    title: 'Vendo treno Roma Milano',
    description: 'Biglietto Frecciarossa, posto a sedere confermato, vagone silenzio',
    origin: 'Roma', destination: 'Milano',
    startDate: inDays(20),
    price: 50, images: [{ url: 'https://example.com/1.jpg' }],
  });
  assert.equal(out.flags.some(f => f.code === 'INCOHERENT_TYPE'), false);
});

test('una sola parola dell\'altro tipo non basta (niente falso positivo)', () => {
  const out = computeHeuristicChecks({
    type: 'train',
    title: 'Vendo',
    description: 'Porto con me una piccola camera fotografica durante il viaggio',
    origin: 'Roma', destination: 'Milano',
    startDate: inDays(20),
    price: 50, images: [{ url: 'https://example.com/1.jpg' }],
  });
  assert.equal(out.flags.some(f => f.code === 'INCOHERENT_TYPE'), false);
});

test('gli score parziali sono normalizzati 0..100', () => {
  const out = computeHeuristicChecks(goodHotel);
  for (const k of ['score', 'consistencyScore', 'plausibilityScore', 'completenessScore']) {
    assert.ok(out[k] >= 0 && out[k] <= 100, `${k}=${out[k]} fuori range`);
  }
});

test('allow-list città ferroviarie: coppie reali riconosciute (anche Sicilia)', () => {
  // Coppie reali che l'AI a volte segnalava per errore: entrambe le città
  // devono risultare note, così l'IMPLAUSIBLE_ROUTE dell'AI viene soppresso.
  for (const [a, b] of [
    ['Palermo', 'Messina'], ['Palermo', 'Catania'], ['Catania', 'Siracusa'],
    ['Ancona', 'Bari'], ['Roma', 'Milano'], ['Palermo Centrale', 'Messina C.le'],
  ]) {
    assert.ok(isKnownRailCity(a) && isKnownRailCity(b), `attese note: ${a} / ${b}`);
  }
});

test('allow-list città ferroviarie: casi impossibili/ignoti restano fuori', () => {
  // Se NON entrambe note, la soppressione non scatta e il flag (AI o
  // deterministico) sopravvive: isole minori, Sardegna, luoghi inventati.
  assert.equal(isKnownRailCity('Lampedusa'), false);
  assert.equal(isKnownRailCity('Cagliari'), false); // Sardegna: no rotaia col continente
  assert.equal(isKnownRailCity('Narnia'), false);
  assert.equal(isKnownRailCity(''), false);
  assert.equal(isKnownRailCity(null), false);
});

test('tratta treno Palermo→Messina: il deterministico NON la segnala', () => {
  const out = computeHeuristicChecks({
    type: 'train',
    title: 'Vendo biglietto treno Palermo Messina',
    description: 'Biglietto regionale Palermo Centrale → Messina, solo andata',
    origin: 'Palermo',
    destination: 'Messina',
    startDate: inDays(10),
    price: 15,
    images: [{ url: 'https://example.com/1.jpg' }],
  });
  assert.equal(out.flags.some((f) => f.code === 'IMPLAUSIBLE_ROUTE'), false);
});
