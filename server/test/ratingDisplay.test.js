// Come si mostra la reputazione (lib/ratingDisplay.mjs).
//
// Il double-blind NON sta qui: vive in SQL (get_user_rating conta solo i voti
// rivelati), così nessun client può aggirarlo. Qui c'è solo la presentazione
// dell'aggregato che il database ha già filtrato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRating, starsFor, MIN_RATINGS_FOR_AVERAGE,
} from '../../travelswap_ai/travelswapai/lib/ratingDisplay.mjs';

test('sotto la soglia si mostra "Nuovo", non una media', () => {
  // "5,0" su un voto solo è rumore spacciato per reputazione: chi ha appena
  // iniziato apparirebbe più affidabile di chi ha 30 transazioni a 4,8.
  for (let n = 0; n < MIN_RATINGS_FOR_AVERAGE; n++) {
    const f = formatRating(5, n);
    assert.equal(f.show, true, `n=${n}`);
    assert.equal(f.isNew, true, `n=${n}`);
    assert.equal(f.value, null, `n=${n}`);
    assert.equal(f.count, n);
  }
});

test('raggiunta la soglia compare la media', () => {
  const f = formatRating(4.666, MIN_RATINGS_FOR_AVERAGE);
  assert.equal(f.isNew, false);
  assert.equal(f.value, 4.7, 'arrotondata a un decimale');
  assert.equal(f.count, MIN_RATINGS_FOR_AVERAGE);
});

test('la media resta dentro 1..5 anche con dati sporchi a monte', () => {
  assert.equal(formatRating(7, 10).value, 5);
  assert.equal(formatRating(0, 10).value, 1);
  assert.equal(formatRating(-3, 10).value, 1);
});

test('conteggio assente o assurdo: non si mostra niente', () => {
  // "Non lo sappiamo" (lettura fallita) non è "zero voti": con 0 il badge
  // direbbe "Nuovo" su un utente che magari ha trenta scambi.
  for (const c of [null, undefined, NaN, -1, 'abc']) {
    assert.equal(formatRating(5, c).show, false, String(c));
  }
  // Zero voti VERI, invece, sono un utente nuovo e vanno mostrati come tale.
  const zero = formatRating(null, 0);
  assert.equal(zero.show, true);
  assert.equal(zero.isNew, true);
});

test('media illeggibile con voti presenti: si ripiega su "Nuovo", non su un numero inventato', () => {
  const f = formatRating(null, 12);
  assert.equal(f.isNew, true);
  assert.equal(f.value, null);
  assert.equal(f.count, 12);
});

test('le stelle disegnate corrispondono alla media', () => {
  assert.deepEqual(starsFor(5), { full: 5, half: false });
  assert.deepEqual(starsFor(4.7), { full: 4, half: true }, '4,7 -> arrotonda a 4,5');
  assert.deepEqual(starsFor(4.2), { full: 4, half: false }, '4,2 -> arrotonda a 4');
  assert.deepEqual(starsFor(1), { full: 1, half: false });
});

test('starsFor non esplode su valori non validi', () => {
  assert.deepEqual(starsFor(null), { full: 0, half: false });
  assert.deepEqual(starsFor('abc'), { full: 0, half: false });
  assert.deepEqual(starsFor(99), { full: 5, half: false });
  assert.deepEqual(starsFor(-4), { full: 0, half: false });
});
