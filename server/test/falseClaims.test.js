// Verifica delle affermazioni "manca X" prodotte dall'AI (falseClaims.js).
//
// Caso reale di partenza: descrizione "Vendo treno Palermo mazara 546 seconda
// classe per il 1 agosto 08:07/10:20", spiegazione del punteggio "La
// descrizione non specifica il numero del treno e la classe del biglietto".
// Entrambi i dati sono scritti lì, uno accanto all'altro.
//
// I test tengono insieme le due direzioni, che tirano da parti opposte:
// sopprimere le frasi FALSE senza sopprimere quelle VERE, perché una
// spiegazione mancante è comunque una perdita (CLAUDE.md: il perché del
// punteggio deve restare visibile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  falseMissingClaims, reasonWithoutFalseClaims, fixesWithoutFalseClaims,
} from '../src/services/trust/falseClaims.js';

const ANNUNCIO = {
  title: 'Vendo treno Palermo → Mazara solo andata',
  description: 'Vendo treno Palermo mazara 546 seconda classe per il 1 agosto 08:07/10:20',
  type: 'train', origin: 'Palermo', destination: 'Mazara del Vallo',
  startDate: '2026-08-01T08:07:00Z', price: 30,
};

test('il caso reale: la frase dichiara mancanti due dati che ci sono', () => {
  const frase = 'La descrizione non specifica il numero del treno e la classe del biglietto.';
  const bad = falseMissingClaims(frase, ANNUNCIO);
  assert.deepEqual(bad.sort(), ['classe', 'numero_treno']);
  assert.equal(reasonWithoutFalseClaims(frase, ANNUNCIO), null);
});

test('una spiegazione VERA non viene toccata', () => {
  // Nessuno di questi dati è nell'annuncio, oppure la frase non parla di
  // assenza: deve passare intatta.
  for (const frase of [
    'Il titolo ripete la descrizione senza aggiungere informazioni utili.',
    'La descrizione non indica il nome del titolare del biglietto.',
    'Il testo è scritto tutto in minuscolo e si legge con fatica.',
    'La descrizione non specifica se il biglietto è rimborsabile.',
  ]) {
    assert.equal(reasonWithoutFalseClaims(frase, ANNUNCIO), frase, frase);
  }
});

test('una frase che non parla di assenze non viene mai analizzata', () => {
  const frase = 'La classe del biglietto è indicata chiaramente.';
  assert.deepEqual(falseMissingClaims(frase, ANNUNCIO), []);
});

test('il numero del treno è riconosciuto nelle forme d\'uso comune', () => {
  const frase = 'Manca il numero del treno.';
  for (const desc of [
    'treno 546 per Palermo', 'treno n. 9512', 'treno numero 12345',
    'FR 9512 in partenza', 'IC 546', 'REG 12345', 'Regionale 546 delle 08:07',
  ]) {
    assert.ok(
      falseMissingClaims(frase, { description: desc }).includes('numero_treno'),
      `non riconosciuto in: ${desc}`,
    );
  }
});

test('un anno o un importo non vengono scambiati per numero di treno', () => {
  // Se li scambiasse, sopprimerebbe una segnalazione VERA.
  const frase = 'Manca il numero del treno.';
  for (const desc of [
    'Biglietto per il 1 agosto 2026',
    'Prezzo 1200 euro trattabili',
    'Costo €1500 tutto compreso',
  ]) {
    assert.deepEqual(
      falseMissingClaims(frase, { description: desc }), [],
      `falso positivo su: ${desc}`,
    );
  }
});

test('la classe è riconosciuta nelle sue diverse forme', () => {
  const frase = 'Non è indicata la classe.';
  for (const desc of [
    'seconda classe', 'prima classe', '2ª classe', '1a classe',
    'posto business', 'tariffa standard', 'economy',
  ]) {
    assert.ok(
      falseMissingClaims(frase, { description: desc }).includes('classe'),
      `non riconosciuta in: ${desc}`,
    );
  }
});

test('orario, prezzo e data si verificano anche sui campi strutturati', () => {
  const soloStrutturati = { title: 'Treno', description: 'Cedo il posto.', startDate: '2026-08-01T08:07:00Z', price: 30 };
  assert.ok(falseMissingClaims('Manca il prezzo.', soloStrutturati).includes('prezzo'));
  assert.ok(falseMissingClaims('Manca la data.', soloStrutturati).includes('data'));
  assert.ok(falseMissingClaims("Non è indicato l'orario.", soloStrutturati).includes('orario'));
});

test('senza testo e senza campi non si sopprime nulla', () => {
  // Qui l'AI potrebbe avere ragione: niente con cui contraddirla.
  assert.deepEqual(falseMissingClaims('Manca il numero del treno.', {}), []);
  assert.deepEqual(falseMissingClaims('Manca il prezzo.', { title: '', description: '' }), []);
});

test('input vuoti o assenti non fanno esplodere nulla', () => {
  assert.deepEqual(falseMissingClaims('', ANNUNCIO), []);
  assert.deepEqual(falseMissingClaims(null, ANNUNCIO), []);
  assert.deepEqual(falseMissingClaims('Manca tutto.', null), []);
  assert.equal(reasonWithoutFalseClaims(null, ANNUNCIO), null);
});

test('i suggerimenti si filtrano uno per uno, non in blocco', () => {
  const fixes = [
    { field: 'description', suggestion: 'Aggiungere il numero del treno e confermare la classe.' },
    { field: 'description', suggestion: 'Indicare se il biglietto è cedibile a terzi.' },
    { field: 'images', suggestion: 'Aggiungere una foto del biglietto.' },
  ];
  const out = fixesWithoutFalseClaims(fixes, ANNUNCIO);
  assert.equal(out.length, 2, 'deve cadere solo il primo');
  assert.ok(out.every((f) => !/numero del treno/i.test(f.suggestion)));
});

/* ===== Tratta messa in dubbio quando l'allow-list dice che è percorribile ===== */

test('la tratta valida non può essere messa in dubbio in prosa', () => {
  // computeTrustScore scartava già il FLAG IMPLAUSIBLE_ROUTE su questa tratta
  // (punteggio 90, non il tetto di 35), ma la stessa obiezione scritta a
  // parole passava intatta: stessa decisione, canale diverso.
  const frase = 'Punteggio non massimo: La durata del viaggio è plausibile, ma la tratta Palermo → Mazara non è segnalata come valida per il treno.';
  assert.deepEqual(falseMissingClaims(frase, ANNUNCIO), ['tratta_valida']);
  assert.equal(reasonWithoutFalseClaims(frase, ANNUNCIO), null);

  const fixes = [{ field: 'route', suggestion: "Verificare se la tratta è corretta o se esiste un'alternativa valida." }];
  assert.deepEqual(fixesWithoutFalseClaims(fixes, ANNUNCIO), []);
});

test('il dubbio sulla tratta si sopprime anche in inglese e spagnolo', () => {
  // Le frasi arrivano nella lingua dell'utente: coprire solo l'italiano
  // lascerebbe passare lo stesso errore a chi usa en/es.
  for (const frase of [
    'The Palermo → Mazara route is not a valid train connection.',
    'El trayecto Palermo → Mazara no es válido para el tren.',
  ]) {
    assert.equal(reasonWithoutFalseClaims(frase, ANNUNCIO), null, frase);
  }
});

test('una tratta davvero impossibile resta segnalata', () => {
  // Il punto delicato: se sopprimessimo anche questa, nasconderemmo un
  // problema vero. Pantelleria è un'isola, non è nell'allow-list.
  const isola = { ...ANNUNCIO, destination: 'Pantelleria' };
  const frase = 'La tratta Palermo → Pantelleria non è valida per il treno.';
  assert.deepEqual(falseMissingClaims(frase, isola), []);
  assert.equal(reasonWithoutFalseClaims(frase, isola), frase);
});

test('"non ci sono treni diretti" è un\'altra affermazione e resta', () => {
  // L'allow-list dice che la tratta è percorribile sulla rete, non che si
  // faccia senza cambi: quella frase può essere vera e non va zittita.
  for (const frase of [
    'La tratta non è servita da treni diretti.',
    'There is no direct train on this route.',
  ]) {
    assert.equal(reasonWithoutFalseClaims(frase, ANNUNCIO), frase, frase);
  }
});

test('il dubbio su un hotel non viene trattato come dubbio di tratta', () => {
  const hotel = { title: 'Hotel', description: 'Camera doppia', type: 'hotel', location: 'Firenze' };
  const frase = 'La struttura non è indicata con chiarezza.';
  assert.equal(reasonWithoutFalseClaims(frase, hotel), frase);
});

test('fixesWithoutFalseClaims regge input non validi', () => {
  assert.deepEqual(fixesWithoutFalseClaims(null, ANNUNCIO), []);
  assert.deepEqual(fixesWithoutFalseClaims(undefined, ANNUNCIO), []);
  assert.deepEqual(fixesWithoutFalseClaims([{}], ANNUNCIO), [{}]);
});
