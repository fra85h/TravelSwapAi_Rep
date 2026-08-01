// extractPriceFactsFromAnswers: le risposte pubbliche del venditore alle
// domande a risposta chiusa diventano fatti utili all'analisi prezzo.
// Funzione pura, nessun database: qui si verifica proprio la logica di scelta
// (quali codici contano, quali risposte sono informative, quale vince).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPriceFactsFromAnswers,
  PRICE_RELEVANT_QUESTION_CODES,
} from '../src/models/listingQuestions.js';

test('nessuna risposta -> nessun fatto', () => {
  assert.deepEqual(extractPriceFactsFromAnswers([]), {});
  assert.deepEqual(extractPriceFactsFromAnswers(null), {});
});

test('operatore e classe risposti -> etichette leggibili per il prompt', () => {
  const facts = extractPriceFactsFromAnswers([
    { code: 'operator', answer: 'italo', answered_at: '2026-08-01T10:00:00Z' },
    { code: 'ticket_class', answer: 'first', answered_at: '2026-08-01T10:00:00Z' },
  ]);
  assert.equal(facts.operator, 'Italo');
  assert.equal(facts.ticketClass, 'prima classe');
});

test('una domanda ancora senza risposta non produce nulla', () => {
  // answered_at NULL = il venditore non ha ancora risposto: la riga esiste
  // (la domanda è stata posta) ma non porta informazione.
  const facts = extractPriceFactsFromAnswers([
    { code: 'operator', answer: null, answered_at: null },
  ]);
  assert.deepEqual(facts, {});
});

test('"unknown" e "other" non sono informazioni di prezzo', () => {
  // Sono risposte oneste ("non lo so", "un altro operatore") ma non
  // identificano una fascia: passarle al modello non lo aiuterebbe, e
  // rischierebbe di fargli credere di sapere qualcosa che non sa.
  const facts = extractPriceFactsFromAnswers([
    { code: 'operator', answer: 'unknown', answered_at: '2026-08-01T10:00:00Z' },
    { code: 'ticket_class', answer: 'unknown', answered_at: '2026-08-01T10:00:00Z' },
  ]);
  assert.deepEqual(facts, {});
  assert.deepEqual(
    extractPriceFactsFromAnswers([{ code: 'operator', answer: 'other', answered_at: '2026-08-01T10:00:00Z' }]),
    {},
  );
});

test('più compratori, stessa domanda: vince la risposta più recente', () => {
  // Il vincolo di unicità è su (annuncio, chi chiede, codice), non sul solo
  // codice: lo stesso venditore può aver risposto più volte nel tempo.
  const facts = extractPriceFactsFromAnswers([
    { code: 'ticket_class', answer: 'second', answered_at: '2026-08-01T09:00:00Z' },
    { code: 'ticket_class', answer: 'business', answered_at: '2026-08-01T18:00:00Z' },
    { code: 'ticket_class', answer: 'standard', answered_at: '2026-08-01T12:00:00Z' },
  ]);
  assert.equal(facts.ticketClass, 'business');
});

test('le domande non attinenti al prezzo vengono ignorate', () => {
  // "delivery" o "refundable" hanno risposte valide ma qui non entrano:
  // l'elenco dei codici rilevanti è esplicito, non è "tutto ciò che arriva".
  const facts = extractPriceFactsFromAnswers([
    { code: 'delivery', answer: 'on_accept', answered_at: '2026-08-01T10:00:00Z' },
    { code: 'name_change_who', answer: 'seller', answered_at: '2026-08-01T10:00:00Z' },
  ]);
  assert.deepEqual(facts, {});
});

test('righe malformate non fanno esplodere nulla', () => {
  const facts = extractPriceFactsFromAnswers([
    null,
    {},
    { code: 'operator', answer: 'italo', answered_at: 'non-una-data' },
    { code: 'operator', answer: 'trenitalia', answered_at: '2026-08-01T10:00:00Z' },
  ]);
  assert.equal(facts.operator, 'Trenitalia');
});

test('i codici rilevanti sono quelli attesi', () => {
  assert.deepEqual([...PRICE_RELEVANT_QUESTION_CODES].sort(), ['operator', 'ticket_class']);
});
