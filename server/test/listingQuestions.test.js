// Catalogo delle domande sull'annuncio (lib/listingQuestions.mjs).
//
// È il contratto fra server e client: il server valida contro questo elenco
// prima di registrare una domanda, il client ci costruisce l'interfaccia. Un
// disallineamento qui significa o domande che il server rifiuta dopo averle
// mostrate, o risposte accettate che nessuna schermata sa tradurre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_CATALOG, getQuestion, isValidAnswer, questionsForListing, canAskAbout,
  ANSWER_UNKNOWN,
} from '../../travelswap_ai/travelswapai/lib/listingQuestions.mjs';

const TRENO = {
  id: 'l1', user_id: 'venditore', type: 'train',
  status: 'active', cerco_vendo: 'VENDO',
  operator: null, ticket_class: null, is_named_ticket: false,
};

test('ogni voce del catalogo è ben formata', () => {
  const codici = new Set();
  for (const q of QUESTION_CATALOG) {
    assert.match(q.code, /^[a-z_]+$/, `codice non valido: ${q.code}`);
    assert.ok(!codici.has(q.code), `codice duplicato: ${q.code}`);
    codici.add(q.code);
    assert.ok(['train', 'hotel'].includes(q.type), `tipo non valido in ${q.code}`);
    assert.ok(Array.isArray(q.answers) && q.answers.length >= 2, `risposte insufficienti in ${q.code}`);
    assert.equal(new Set(q.answers).size, q.answers.length, `risposte duplicate in ${q.code}`);
    assert.equal(typeof q.showWhen, 'function', `showWhen mancante in ${q.code}`);
  }
});

test('nessuna domanda ammette testo libero', () => {
  // È tutto il senso del progetto: senza campo libero non ci sono recapiti da
  // intercettare né moderazione da pagare. Se un giorno qualcuno aggiunge una
  // voce con risposte aperte, questo test lo ferma.
  for (const q of QUESTION_CATALOG) {
    for (const a of q.answers) {
      assert.match(a, /^[a-z_]+$/, `risposta non chiusa in ${q.code}: ${a}`);
    }
  }
});

test('le domande su dati già presenti spariscono', () => {
  // operator è una colonna che l'AI riempie: chiederlo quando c'è già
  // significa far scrivere il compratore per un dato stampato sulla scheda.
  const senza = questionsForListing(TRENO).map((q) => q.code);
  assert.ok(senza.includes('operator'));
  assert.ok(senza.includes('ticket_class'));

  const con = questionsForListing({ ...TRENO, operator: 'Trenitalia', ticket_class: 'second' })
    .map((q) => q.code);
  assert.ok(!con.includes('operator'), 'operator già noto, non va chiesto');
  assert.ok(!con.includes('ticket_class'), 'classe già nota, non va chiesta');
});

test('il cambio nominativo si chiede solo sui biglietti nominativi', () => {
  const nonNominativo = questionsForListing(TRENO).map((q) => q.code);
  assert.ok(!nonNominativo.includes('name_change_who'));
  assert.ok(!nonNominativo.includes('name_change_cost'));

  const nominativo = questionsForListing({ ...TRENO, is_named_ticket: true }).map((q) => q.code);
  assert.ok(nominativo.includes('name_change_who'));
  assert.ok(nominativo.includes('name_change_cost'), 'chi lo fa e chi lo paga sono due domande');
});

test('le domande già poste non vengono riproposte', () => {
  const codici = questionsForListing(TRENO, ['operator', 'refundable']).map((q) => q.code);
  assert.ok(!codici.includes('operator'));
  assert.ok(!codici.includes('refundable'));
  assert.ok(codici.includes('delivery'));
});

test('un annuncio hotel non riceve le domande dei treni', () => {
  const codici = questionsForListing({ ...TRENO, type: 'hotel' }).map((q) => q.code);
  assert.deepEqual(codici, [], 'le domande hotel non sono ancora definite');
});

test('solo le risposte previste sono accettate', () => {
  assert.equal(isValidAnswer('operator', 'italo'), true);
  assert.equal(isValidAnswer('operator', ANSWER_UNKNOWN), true);
  assert.equal(isValidAnswer('operator', 'ryanair'), false);
  assert.equal(isValidAnswer('operator', ''), false);
  assert.equal(isValidAnswer('codice_inventato', 'italo'), false);
  assert.equal(isValidAnswer('refundable', 'changeable_only'), true);
});

test('getQuestion non inventa domande', () => {
  assert.equal(getQuestion('refundable')?.code, 'refundable');
  assert.equal(getQuestion('non_esiste'), null);
  assert.equal(getQuestion(null), null);
  assert.equal(getQuestion(''), null);
});

/* ===== Chi può chiedere ===== */

test('si può chiedere solo su un VENDO attivo di qualcun altro', () => {
  assert.equal(canAskAbout(TRENO, 'compratore').allowed, true);
});

test('su un CERCO non c\'è nessun biglietto di cui chiedere', () => {
  const esito = canAskAbout({ ...TRENO, cerco_vendo: 'CERCO' }, 'compratore');
  assert.equal(esito.allowed, false);
  assert.equal(esito.reason, 'not_a_vendo');
});

test('al proprio annuncio non si fanno domande', () => {
  const esito = canAskAbout(TRENO, 'venditore');
  assert.equal(esito.allowed, false);
  assert.equal(esito.reason, 'own_listing');
});

test('un annuncio non attivo non riceve domande', () => {
  for (const stato of ['paused', 'sold', 'expired', 'reserved']) {
    const esito = canAskAbout({ ...TRENO, status: stato }, 'compratore');
    assert.equal(esito.allowed, false, stato);
    assert.equal(esito.reason, 'listing_not_active');
  }
});

test('senza utente autenticato non si chiede niente', () => {
  assert.equal(canAskAbout(TRENO, null).reason, 'not_authenticated');
  assert.equal(canAskAbout(TRENO, '').reason, 'not_authenticated');
});

test('input malformati non fanno passare nulla', () => {
  assert.equal(canAskAbout(null, 'x').allowed, false);
  assert.equal(canAskAbout({}, 'x').allowed, false);
  assert.equal(canAskAbout(undefined, undefined).allowed, false);
});
