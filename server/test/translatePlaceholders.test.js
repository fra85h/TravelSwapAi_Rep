// Test della protezione dei segnaposto nelle traduzioni
// (services/trust/translate/openaiProvider.js).
//
// I segnaposto ({count}, <<NOME>>) sono i punti in cui l'app inserisce valori
// a runtime: se una traduzione li altera o li traduce, il testo mostrato
// all'utente resta con il segnaposto grezzo o perde il valore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PH_RE, protect, restore, normalize } from '../src/services/trust/translate/openaiProvider.js';

test('riconosce entrambe le forme di segnaposto', () => {
  assert.deepEqual('ciao {NOME} e <<COGNOME>>'.match(PH_RE), ['{NOME}', '<<COGNOME>>']);
});

test('protect sostituisce i segnaposto con token neutri', () => {
  const { safe, m } = protect('Hai {COUNT} messaggi da <<UTENTE>>');
  assert.equal(safe, 'Hai __PH_0__ messaggi da __PH_1__');
  assert.equal(m.size, 2);
});

test('protect/restore è un giro completo senza perdite', () => {
  const src = 'Hai {COUNT} messaggi da <<UTENTE>> il {DATA}';
  const { safe, m } = protect(src);
  assert.equal(restore(safe, m), src);
});

test('i segnaposto sopravvivono a una traduzione che riordina il testo', () => {
  const { safe, m } = protect('Hai {COUNT} messaggi da <<UTENTE>>');
  // simula il modello: traduce attorno ai token, cambiando l'ordine
  const tradotto = 'From __PH_1__ you have __PH_0__ messages';
  assert.equal(restore(tradotto, m), 'From <<UTENTE>> you have {COUNT} messages');
});

test('oltre dieci segnaposto non si sovrascrivono tra loro', () => {
  // __PH_1__ non deve corrompere __PH_11__ durante il restore
  const src = Array.from({ length: 13 }, (_, i) => `{P${i}}`).join(' ');
  const { safe, m } = protect(src);
  assert.equal(restore(safe, m), src);
});

test('normalize corregge il nome del prodotto e di TrustScore', () => {
  assert.equal(normalize('benvenuto su travelswapai'), 'benvenuto su TravelSwap');
  // Nome vecchio e varianti con spazio: vanno tutte al nome attuale.
  assert.equal(normalize('benvenuto su travel swap ai'), 'benvenuto su TravelSwap');
  assert.equal(normalize('benvenuto su travelswap'), 'benvenuto su TravelSwap');
  assert.equal(normalize('benvenuto su TravelSwap'), 'benvenuto su TravelSwap');
  assert.equal(normalize('il tuo trust score è alto'), 'il tuo TrustScore è alto');
  assert.equal(normalize('il tuo trustscore'), 'il tuo TrustScore');
});

test('normalize non tocca i token di protezione', () => {
  assert.equal(normalize('valore __PH_0__ e __PH_1__'), 'valore __PH_0__ e __PH_1__');
});

test('normalize non deve poter riscrivere il CONTENUTO di un segnaposto', () => {
  // Regressione: applicando normalize DOPO restore, un segnaposto chiamato
  // {TRUSTSCORE} diventava {TrustScore} e l'app non lo riconosceva più.
  // Con l'ordine corretto (normalize sul testo protetto, poi restore) il
  // nome del segnaposto resta intatto.
  const { safe, m } = protect('il tuo {TRUSTSCORE} vale');
  assert.equal(restore(normalize(safe), m), 'il tuo {TRUSTSCORE} vale');
});

test('un testo senza segnaposto attraversa protect/restore invariato', () => {
  const src = 'nessun segnaposto qui';
  const { safe, m } = protect(src);
  assert.equal(safe, src);
  assert.equal(restore(safe, m), src);
});

test('input vuoti non fanno esplodere le funzioni', () => {
  assert.equal(protect().safe, '');
  assert.equal(restore('', new Map()), '');
  assert.equal(normalize(), '');
});
