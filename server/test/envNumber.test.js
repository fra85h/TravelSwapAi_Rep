// Lettura dei limiti di concorrenza dall'ambiente (lib/envNumber.js).
//
// Un limite di concorrenza sbagliato non dà un errore: dà un comportamento.
// Con 0 il pool non avvia nessun worker e il ricalcolo non finisce mai; con
// NaN il confronto fallisce silenziosamente. Questi test fissano il
// comportamento per ogni valore che l'ambiente può davvero contenere,
// stringhe vuote e spazi compresi (una variabile "svuotata" su Render resta
// impostata, con valore "").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envInt } from '../src/lib/envNumber.js';

const NOME = 'TEST_ENV_INT_TMP';

function conValore(v, fn) {
  const prima = process.env[NOME];
  if (v === undefined) delete process.env[NOME];
  else process.env[NOME] = v;
  try { fn(); } finally {
    if (prima === undefined) delete process.env[NOME];
    else process.env[NOME] = prima;
  }
}

test('variabile assente: vale il default', () => {
  conValore(undefined, () => assert.equal(envInt(NOME, 2), 2));
});

test('variabile valida: vince sull\'ambiente', () => {
  conValore('5', () => assert.equal(envInt(NOME, 2), 5));
});

test('stringa vuota o soli spazi: vale il default, non 0', () => {
  // È il caso che rompeva: Number('') è 0, e con `?? default` la stringa
  // vuota non è nullish, quindi passava e diventava un limite di 0.
  conValore('',    () => assert.equal(envInt(NOME, 2), 2));
  conValore('   ', () => assert.equal(envInt(NOME, 2), 2));
});

test('valore non numerico: vale il default, non NaN', () => {
  conValore('due',  () => assert.equal(envInt(NOME, 3), 3));
  conValore('4abc', () => assert.equal(envInt(NOME, 3), 3));
});

test('zero e negativi sono riportati al minimo', () => {
  // Un pool con limite 0 non avvia nessun worker: il lavoro resta appeso.
  conValore('0',  () => assert.equal(envInt(NOME, 2), 1));
  conValore('-7', () => assert.equal(envInt(NOME, 2), 1));
});

test('i decimali vengono troncati a intero', () => {
  conValore('3.9', () => assert.equal(envInt(NOME, 2), 3));
});

test('il tetto massimo, quando indicato, viene rispettato', () => {
  conValore('999', () => assert.equal(envInt(NOME, 2, { max: 10 }), 10));
});

test('un default assurdo non produce comunque un limite inutilizzabile', () => {
  conValore(undefined, () => {
    assert.equal(envInt(NOME, 0), 1);
    assert.equal(envInt(NOME, NaN), 1);
    assert.equal(envInt(NOME, undefined), 1);
  });
});
