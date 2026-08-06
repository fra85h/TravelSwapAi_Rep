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

import { chainFingerprint, canSkipRecompute, listingsStamp } from '../src/lib/chainFingerprint.js';

const L = (count, at) => ({ count, lastChangeAt: at });

// Un annuncio come lo legge listActiveListings, ridotto ai campi che
// contano qui.
const ann = (over = {}) => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  user_id: 'u1',
  status: 'active',
  type: 'train',
  cerco_vendo: 'VENDO',
  route_from: 'Roma',
  route_to: 'Milano',
  location: null,
  depart_at: '2026-09-10T09:00:00Z',
  check_in: null,
  accepts_swap: true,
  swap_wanted: 'Firenze',
  price: 80,
  ...over,
});

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

// ----------------------------------------------------------------------
// L'impronta degli annunci: sui CAMPI, non su updated_at.
// ----------------------------------------------------------------------

test('il PREZZO non cambia l\'impronta, ed è il motivo per cui questa funzione esiste', () => {
  // La regressione vera: l'impronta guardava listings.updated_at, e il
  // decadimento automatico dei prezzi scrive un UPDATE per ogni annuncio
  // in scadenza a ogni giro. Bastava quello per invalidare l'impronta ogni
  // 15 minuti e ricalcolare tutte le catene, a pagamento, senza che nulla
  // di rilevante per i cicli fosse cambiato. Il prezzo al punteggio delle
  // catene non partecipa: qui deve essere invisibile.
  const prima = listingsStamp([ann({ price: 80 })]);
  const dopo = listingsStamp([ann({ price: 41.5 })]);
  assert.equal(prima.digest, dopo.digest);
});

test('l\'ordine delle righe non conta', () => {
  // Postgres non garantisce un ordine se non glielo si chiede, e
  // un'impronta che cambia per il solo ordine farebbe ricalcolare a caso.
  const a = ann({ id: 'a' });
  const b = ann({ id: 'b' });
  assert.equal(listingsStamp([a, b]).digest, listingsStamp([b, a]).digest);
});

test('cambiare tratta, data, tipo o direzione cambia l\'impronta', () => {
  const base = listingsStamp([ann()]).digest;
  for (const modifica of [
    { route_to: 'Torino' },
    { route_from: 'Napoli' },
    { depart_at: '2026-09-11T09:00:00Z' },
    { type: 'hotel' },
    { cerco_vendo: 'CERCO' },
    { user_id: 'u2' },
    { swap_wanted: 'Bologna' },
    { accepts_swap: false },
    { location: 'Roma-->Milano' },
    { status: 'paused' },
  ]) {
    assert.notEqual(listingsStamp([ann(modifica)]).digest, base, `invisibile: ${JSON.stringify(modifica)}`);
  }
});

test('un annuncio in più cambia conteggio e impronta', () => {
  const uno = listingsStamp([ann({ id: 'a' })]);
  const due = listingsStamp([ann({ id: 'a' }), ann({ id: 'b' })]);
  assert.equal(uno.count, 1);
  assert.equal(due.count, 2);
  assert.notEqual(uno.digest, due.digest);
});

test('nessun annuncio è uno stato valido, non un errore', () => {
  const vuoto = listingsStamp([]);
  assert.equal(vuoto.count, 0);
  assert.equal(listingsStamp(null).digest, vuoto.digest);
  assert.notEqual(listingsStamp([ann()]).digest, vuoto.digest);
});

test('l\'impronta completa distingue i due ingressi', () => {
  const annunci = listingsStamp([ann()]);
  const catene = { count: 2, lastChangeAt: '2026-08-05T19:00:00Z' };
  const f = chainFingerprint(annunci, catene);
  assert.match(f, /^1\|[0-9a-f]{12}~2\|2026-08-05T19:00:00Z$/);
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
