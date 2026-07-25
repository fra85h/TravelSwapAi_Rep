// Test delle regole testuali del CLIENT (app/lib/textPatterns.mjs).
//
// Vivono qui perché la CI esegue solo la suite del server (`cd server &&
// node --test`): il modulo è .mjs proprio per essere importabile sia da
// Metro sia da Node. Se un giorno l'app avrà una CI propria, questo file può
// traslocare senza modifiche.
//
// Sono le regole che riempiono i campi dell'annuncio a partire dal testo
// scritto o incollato dall'utente: sbagliarle significa pubblicare una tratta
// o una direzione del denaro diverse da quelle reali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guessCercoVendoFromText,
  detectTwoListings,
  countListingSignals,
  looksLikeRyanair,
  DATE_ANY_RE,
  DATE_TEXT_RE,
  TIME_RE,
  IATA_PAIR_RE,
  TRAIN_KEYWORDS_RE,
  ROUTE_TEXT_RE,
  ROUTE_ARROW_RE,
  PNR_RE,
  extractPrice,
  extractRoute,
  findKnownRoutes,
} from '../../travelswap_ai/travelswapai/lib/textPatterns.mjs';

/* ============ Prezzo ============ */

test('prezzo: importi a più cifre non vengono troncati', () => {
  // Regressione: la classe era `[0-9]`, UNA cifra. "€ 45" dava 4 e
  // "€ 120,50" dava 1, e quel valore finiva nel campo prezzo dell'annuncio.
  assert.equal(extractPrice('prezzo € 45'), 45);
  assert.equal(extractPrice('€ 120,50'), 120.5);
  assert.equal(extractPrice('totale EUR 89'), 89);
});

test('prezzo: valuta prima o dopo l\'importo', () => {
  assert.equal(extractPrice('45 €'), 45);
  assert.equal(extractPrice('prezzo 39,90 EUR'), 39.9);
});

test('prezzo: separatore delle migliaia in formato italiano', () => {
  assert.equal(extractPrice('€1.250,00'), 1250);
  assert.equal(extractPrice('€ 1.250'), 1250);
});

test('prezzo: senza valuta non inventa un importo', () => {
  assert.equal(extractPrice('il treno 8164 parte alle 00:50'), null);
  assert.equal(extractPrice('nessun prezzo qui'), null);
  assert.equal(extractPrice(''), null);
  assert.equal(extractPrice(null), null);
});

/* ============ Tratte sull'elenco stazioni (whitelist) ============ */

test('tratta: le parole estranee non entrano nella destinazione', () => {
  // La stoplist da sola non bastava: "con" non era fra le parole previste e
  // la destinazione diventava "Roma con".
  assert.deepEqual(extractRoute('Milano - Roma con supplemento'), { from: 'Milano', to: 'Roma' });
});

test('tratta: un nome di città col trattino non è una tratta', () => {
  // "Reggio-Emilia" è UNA città: le regex la spezzavano in Reggio→Emilia.
  assert.equal(extractRoute('biglietto Reggio-Emilia del 12'), null);
});

test('tratta: le stazioni sono riportate nella forma canonica dell\'elenco', () => {
  assert.deepEqual(
    extractRoute('Milano Centrale → Roma Termini'),
    { from: 'Milano — Centrale', to: 'Roma — Termini' }
  );
});

test('tratta: due città note accostate sono una tratta', () => {
  assert.deepEqual(
    extractRoute('treno 8164 Milano Piacenza prima classe'),
    { from: 'Milano', to: 'Piacenza' }
  );
});

test('tratta: le località fuori elenco restano gestite dalle regex', () => {
  // La whitelist non deve far perdere copertura su ciò che non conosce.
  assert.deepEqual(
    extractRoute('Sconosciutopoli - Altrove'),
    { from: 'Sconosciutopoli', to: 'Altrove' }
  );
});

test('tratte note: più tratte in sequenza vengono riconosciute tutte', () => {
  assert.deepEqual(
    findKnownRoutes('Bologna-Firenze e Firenze-Roma'),
    [{ from: 'Bologna', to: 'Firenze' }, { from: 'Firenze', to: 'Roma' }]
  );
});

test('tratte note: testo senza località note non produce tratte', () => {
  assert.deepEqual(findKnownRoutes('vendo prenotazione ottima occasione'), []);
  assert.deepEqual(findKnownRoutes(''), []);
});

/* ============ CERCO / VENDO: la direzione del denaro ============ */

test('CERCO/VENDO: riconosce i verbi di richiesta', () => {
  for (const s of ['cerco un biglietto per Roma', 'cercasi hotel a Milano', 'compro biglietto', 'acquisto una prenotazione', 'mi serve un biglietto', 'sto cercando un hotel']) {
    assert.equal(guessCercoVendoFromText(s), 'CERCO', s);
  }
});

test('CERCO/VENDO: riconosce i verbi di offerta', () => {
  for (const s of ['vendo un biglietto', 'cedo la mia prenotazione', 'rivendo biglietto treno', 'offro camera hotel', 'metto in vendita un biglietto', 'scambio biglietto']) {
    assert.equal(guessCercoVendoFromText(s), 'VENDO', s);
  }
});

test('CERCO/VENDO: con entrambi i segnali vince CERCO (errore meno dannoso)', () => {
  // Un VENDO sbagliato dichiara di possedere un biglietto inesistente, e su
  // quello gli altri fanno offerte; un CERCO sbagliato è solo una richiesta.
  assert.equal(guessCercoVendoFromText('vendo biglietto ma cerco anche uno scambio'), 'CERCO');
});

test('CERCO/VENDO: senza segnali non indovina', () => {
  assert.equal(guessCercoVendoFromText('biglietto treno Milano Roma 12 marzo'), null);
  assert.equal(guessCercoVendoFromText(''), null);
  assert.equal(guessCercoVendoFromText(null), null);
});

test('CERCO/VENDO: i verbi sono parole intere, non frammenti', () => {
  // "ricerco"/"vendola" non devono contare come segnali
  assert.equal(guessCercoVendoFromText('la ricerca del posto migliore'), null);
});

/* ============ Tratte: estrazione partenza/destinazione ============ */

test('tratta con "da ... a ...": non si porta dietro le parole successive', () => {
  // Regressione: la destinazione era "Roma prima classe" e finiva nel campo A
  const m = 'biglietto da Milano a Roma prima classe'.match(ROUTE_TEXT_RE);
  assert.ok(m, 'nessun match');
  assert.equal(m[1].trim(), 'Milano');
  assert.equal(m[2].trim(), 'Roma');
});

test('tratta con "da ... a ...": stazioni composte restano intere', () => {
  const m = 'da Milano Centrale a Roma Termini seconda classe'.match(ROUTE_TEXT_RE);
  assert.ok(m);
  assert.equal(m[1].trim(), 'Milano Centrale');
  assert.equal(m[2].trim(), 'Roma Termini');
});

test('tratta con freccia/trattino: non ingloba il testo attorno', () => {
  // Regressione: la partenza era "vendo biglietto Milano"
  const m = 'vendo biglietto Milano - Roma seconda classe'.match(ROUTE_ARROW_RE);
  assert.ok(m);
  assert.equal(m[1].trim(), 'Milano');
  assert.equal(m[2].trim(), 'Roma');
});

test('tratta con freccia: località composte', () => {
  const m = 'biglietto Reggio Calabria → Milano Centrale'.match(ROUTE_ARROW_RE);
  assert.ok(m);
  assert.equal(m[1].trim(), 'Reggio Calabria');
  assert.equal(m[2].trim(), 'Milano Centrale');
});

test('tratta: un testo senza tratta non ne inventa una', () => {
  assert.equal(ROUTE_ARROW_RE.test('vendo prenotazione ottima occasione'), false);
  assert.equal(ROUTE_TEXT_RE.test('vendo prenotazione ottima occasione'), false);
});

/* ============ Vettore: FR è ambiguo ============ */

test('vettore: un Frecciarossa non diventa un volo Ryanair', () => {
  // Regressione: "FR 9512" bastava per dedurre Ryanair, e il titolo generato
  // diventava "Volo Ryanair Milano → Roma" su un biglietto del treno.
  assert.equal(looksLikeRyanair('Frecciarossa FR 9512 Milano Roma'), false);
  assert.equal(looksLikeRyanair('treno FR9512 delle 10:30'), false);
});

test('vettore: il nome esteso del vettore decide', () => {
  assert.equal(looksLikeRyanair('Volo Ryanair FR1234 BGY-CTA'), true);
  assert.equal(looksLikeRyanair('ryanair booking'), true);
});

test('vettore: nel dubbio non è un volo (la piattaforma tratta treni e hotel)', () => {
  assert.equal(looksLikeRyanair('biglietto Milano Roma'), false);
  assert.equal(looksLikeRyanair(''), false);
});

test('parole chiave treno: riconosce gli operatori italiani', () => {
  for (const s of ['Trenitalia', 'Frecciarossa', 'Italo', 'Intercity', 'Regionale', 'Frecciargento']) {
    assert.equal(TRAIN_KEYWORDS_RE.test(s), true, s);
  }
});

test('parole chiave treno: il codice Frecciarossa è riconosciuto per intero', () => {
  // Regressione: `FR\s?\d` col \b finale matchava una sola cifra, e su un
  // numero reale il confine cadeva tra le cifre — nessun codice a più cifre
  // veniva riconosciuto come treno.
  for (const s of ['FR9512', 'FR 9512', 'fr 305']) {
    assert.equal(TRAIN_KEYWORDS_RE.test(s), true, s);
  }
  // e la parola "treno" da sola è già un indizio ferroviario
  assert.equal(TRAIN_KEYWORDS_RE.test('biglietto treno 8164'), true);
});

/* ============ Date, orari, PNR ============ */

test('date: formati giorno/mese/anno e ISO', () => {
  assert.deepEqual('partenza 12/03/2026'.match(DATE_ANY_RE).slice(1, 4), ['12', '03', '2026']);
  const iso = '2026-03-12 partenza'.match(DATE_ANY_RE);
  assert.deepEqual(iso.slice(4, 7), ['2026', '03', '12']);
});

test('date: forma testuale "12 marzo 2026"', () => {
  const m = 'il 12 marzo 2026 parto'.match(DATE_TEXT_RE);
  assert.ok(m);
  assert.deepEqual([m[1], m[2], m[3]], ['12', 'marzo', '2026']);
});

test('orari: accetta 00:50 e rifiuta orari impossibili', () => {
  assert.deepEqual('partenza 00:50'.match(TIME_RE).slice(1, 3), ['00', '50']);
  assert.deepEqual('alle 23:59'.match(TIME_RE).slice(1, 3), ['23', '59']);
  assert.equal(TIME_RE.test('alle 24:00'), false);
  assert.equal(TIME_RE.test('alle 12:60'), false);
});

test('PNR: estratto solo quando è etichettato', () => {
  assert.equal('codice prenotazione ABC1234 grazie'.match(PNR_RE)[1], 'ABC1234');
  assert.equal('PNR XYZ99A'.match(PNR_RE)[1], 'XYZ99A');
  // un codice qualsiasi senza etichetta non è un PNR
  assert.equal(PNR_RE.test('il treno 8164 parte alle 00:50'), false);
});

test('IATA: coppia di codici aeroportuali', () => {
  const m = 'volo BGY - CTA'.match(IATA_PAIR_RE);
  assert.ok(m);
  assert.deepEqual([m[1], m[2]], ['BGY', 'CTA']);
});

/* ============ "Sembrano due biglietti" ============ */

test('due biglietti: una descrizione con UN biglietto non viene segnalata', () => {
  // Il caso reale che ha originato il fix: la `a` di "classe" e "biglietto"
  // veniva letta come separatore di tratta e ne risultavano due.
  const r = detectTwoListings('vendo un biglietto per  treno 8164 milano piacenza prima classe 00:50', 'train');
  assert.equal(r.two, false);
});

test('due biglietti: due tratte vere vengono segnalate', () => {
  const r = detectTwoListings('vendo due biglietti: milano-roma e torino-napoli', 'train');
  assert.equal(r.two, true);
  assert.equal(r.reasonKey, 'reasonRoutes');
});

test('due biglietti: una sola tratta non basta', () => {
  assert.equal(detectTwoListings('vendo biglietto milano → roma del 12', 'train').two, false);
  assert.equal(detectTwoListings('biglietto milano-roma seconda classe', 'train').two, false);
});

test('due biglietti: "due biglietti" scritto a lettere viene riconosciuto', () => {
  const r = detectTwoListings('vendo 2 biglietti per lo stesso viaggio', 'train');
  assert.equal(r.two, true);
  assert.equal(r.reasonKey, 'reasonTwoTickets');
});

test('due biglietti: una conferma hotel singola non viene segnalata', () => {
  // Una conferma reale cita già più date (prenotato il / check-in / check-out
  // / scadenza cancellazione) per UN SOLO soggiorno.
  const conferma = 'prenotazione hotel roma check-in 10/03/2026 check-out 12/03/2026 prenotato il 01/02/2026';
  assert.equal(detectTwoListings(conferma, 'hotel').two, false);
});

test('due biglietti: testo troppo corto non viene analizzato', () => {
  assert.equal(detectTwoListings('roma', 'train').two, false);
  assert.equal(detectTwoListings('', 'train').two, false);
  assert.equal(detectTwoListings(null, 'train').two, false);
});

test('conteggio segnali: coerente con quanto è scritto', () => {
  const s = countListingSignals('milano-roma alle 10:30 e torino-napoli alle 14:45 il 12/03/2026');
  assert.equal(s.routes, 2);
  assert.equal(s.times, 2);
  assert.equal(s.dates, 1);
  assert.equal(s.hotels, 0);
});

test('le regex globali non conservano lastIndex tra chiamate', () => {
  // Una regex con flag /g riusata mantiene lastIndex: se il modulo la
  // esponesse condivisa senza reset, la seconda chiamata su un testo identico
  // darebbe un risultato diverso dalla prima.
  const txt = 'vendo due biglietti: milano-roma e torino-napoli';
  const a = detectTwoListings(txt, 'train');
  const b = detectTwoListings(txt, 'train');
  assert.deepEqual(a, b);
  assert.deepEqual(countListingSignals(txt), countListingSignals(txt));
});
