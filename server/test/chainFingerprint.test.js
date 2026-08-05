// "È cambiato qualcosa dall'ultimo giro?" per il ricalcolo delle catene a 3.
//
// Il ricalcolo gira ogni 15 minuti e ricostruisce il grafo dei desideri da
// zero, cioè centinaia di chiamate a OpenAI. Con l'app ferma erano 96
// ricalcoli identici al giorno, pagati tutti.
//
// Ma il rischio del salto è l'opposto del risparmio: saltare un giro che
// SERVIVA significa catene che non compaiono, e nessuno se ne accorge. I
// test qui sotto stanno tutti su quel lato.
import test from 'node:test';
import assert from 'node:assert/strict';

import { chainFingerprint, canSkipRecompute } from '../src/lib/chainFingerprint.js';

const L = (count, at) => ({ count, lastChangeAt: at });

test('stessi ingressi, stessa impronta', () => {
  const a = chainFingerprint(L(333, '2026-08-05T20:00:00Z'), L(2, '2026-08-05T19:00:00Z'));
  const b = chainFingerprint(L(333, '2026-08-05T20:00:00Z'), L(2, '2026-08-05T19:00:00Z'));
  assert.equal(a, b);
});

test('un annuncio nuovo cambia l\'impronta', () => {
  const prima = chainFingerprint(L(333, '2026-08-05T20:00:00Z'), L(2, null));
  const dopo = chainFingerprint(L(334, '2026-08-05T20:05:00Z'), L(2, null));
  assert.notEqual(prima, dopo);
});

test('un annuncio MODIFICATO cambia l\'impronta anche se il conteggio resta uguale', () => {
  // Mettere in pausa, cambiare tratta o prezzo non sposta il numero di
  // annunci attivi... anzi, la pausa sì. Ma una modifica di tratta no: se
  // guardassimo solo il conteggio, il grafo resterebbe quello vecchio.
  const prima = chainFingerprint(L(333, '2026-08-05T20:00:00Z'), L(2, null));
  const dopo = chainFingerprint(L(333, '2026-08-05T20:07:00Z'), L(2, null));
  assert.notEqual(prima, dopo);
});

test('una catena che si CHIUDE cambia l\'impronta, ed è il caso che si dimentica', () => {
  // È l'ingresso non ovvio: chi è dentro una catena in sospeso viene
  // escluso dai cicli nuovi. Quando quella catena si chiude o decade, i
  // suoi partecipanti tornano disponibili e nascono cicli che prima non
  // c'erano — senza che nessuno abbia toccato un solo annuncio.
  const prima = chainFingerprint(L(333, '2026-08-05T20:00:00Z'), L(2, '2026-08-05T19:00:00Z'));
  const dopo = chainFingerprint(L(333, '2026-08-05T20:00:00Z'), L(1, '2026-08-05T19:00:00Z'));
  assert.notEqual(prima, dopo);
});

test('due variazioni opposte non si annullano fra loro', () => {
  // Una catena si chiude e un'altra nasce nello stesso quarto d'ora: il
  // conteggio torna uguale, ma la più recente è nata adesso.
  const prima = chainFingerprint(L(333, '2026-08-05T20:00:00Z'), L(2, '2026-08-05T19:00:00Z'));
  const dopo = chainFingerprint(L(333, '2026-08-05T20:00:00Z'), L(2, '2026-08-05T20:10:00Z'));
  assert.notEqual(prima, dopo);
});

test('un ingresso vuoto non collide con uno pieno', () => {
  assert.notEqual(
    chainFingerprint(L(0, null), L(0, null)),
    chainFingerprint(L(0, null), L(1, '2026-08-05T20:00:00Z')),
  );
});

test('si salta solo con un\'impronta identica', () => {
  assert.equal(canSkipRecompute('X', 'X', 0), true);
  assert.equal(canSkipRecompute('X', 'Y', 0), false);
});

test('al primo giro dopo un riavvio non si salta mai', () => {
  // Meglio un ricalcolo in più che catene ferme perché il server è
  // ripartito e non ricorda com'era il mondo prima.
  assert.equal(canSkipRecompute(null, 'X', 0), false);
  assert.equal(canSkipRecompute(undefined, 'X', 0), false);
  assert.equal(canSkipRecompute('', 'X', 0), false);
});

test('se sono appena scadute delle catene NON si salta, anche con impronta uguale', () => {
  // La scadenza avviene DENTRO questo stesso giro, un istante prima che
  // l'impronta venga letta: ha appena liberato dei proprietari, e quella
  // liberazione non è ancora visibile nei numeri appena letti. Saltare
  // qui vorrebbe dire aspettare altri 15 minuti per proporre cicli che
  // sono già possibili adesso.
  assert.equal(canSkipRecompute('X', 'X', 1), false);
  assert.equal(canSkipRecompute('X', 'X', 5), false);
  assert.equal(canSkipRecompute('X', 'X', 0), true);
});
