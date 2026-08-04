// Il secondo tentativo sulle chiamate a OpenAI.
//
// Nato dal 520 osservato in produzione sull'import PDF: un errore senza
// corpo e senza codice applicativo, cioè il bordo di rete di OpenAI che
// molla. Ritentare una volta lo risolve; ritentare SEMPRE no — su un 400
// (richiesta sbagliata) sarebbe solo un secondo addebito per ottenere lo
// stesso rifiuto.
import test from 'node:test';
import assert from 'node:assert/strict';

import { withOpenAIRetry } from '../src/ai/descriptionParse.js';

const err = (status) => Object.assign(new Error(`errore ${status}`), { status });

test('senza errori chiama una volta sola e restituisce il risultato', async () => {
  let calls = 0;
  const out = await withOpenAIRetry(async () => { calls++; return 'ok'; });
  assert.equal(out, 'ok');
  assert.equal(calls, 1);
});

test('ritenta sui 5xx, che è il caso del 520 senza corpo', async () => {
  let calls = 0;
  const out = await withOpenAIRetry(async () => {
    calls++;
    if (calls === 1) throw err(520);
    return 'ok al secondo giro';
  });
  assert.equal(out, 'ok al secondo giro');
  assert.equal(calls, 2);
});

test('ritenta anche sul 429 (limite di frequenza)', async () => {
  let calls = 0;
  await withOpenAIRetry(async () => {
    calls++;
    if (calls === 1) throw err(429);
    return 'ok';
  });
  assert.equal(calls, 2);
});

test('NON ritenta sui 4xx: la richiesta è sbagliata, riprovarla costa e basta', async () => {
  for (const status of [400, 401, 403, 404, 413]) {
    let calls = 0;
    await assert.rejects(
      () => withOpenAIRetry(async () => { calls++; throw err(status); }),
      /errore/,
    );
    assert.equal(calls, 1, `status ${status}: non deve ritentare`);
  }
});

test('un errore senza status viene trattato come temporaneo', async () => {
  // È il caso di una connessione caduta a metà: nessun codice HTTP, ma
  // niente lascia pensare che la richiesta fosse sbagliata.
  let calls = 0;
  await withOpenAIRetry(async () => {
    calls++;
    if (calls === 1) throw new Error('socket hang up');
    return 'ok';
  });
  assert.equal(calls, 2);
});

test('se fallisce due volte, l\'errore del secondo tentativo arriva al chiamante', async () => {
  let calls = 0;
  await assert.rejects(
    () => withOpenAIRetry(async () => {
      calls++;
      throw err(calls === 1 ? 520 : 503);
    }),
    /errore 503/,
  );
  assert.equal(calls, 2);
});

test('NON ritenta quando il credito è esaurito, anche se è un 429', async () => {
  // Caso reale del 4 agosto. Il 429 di norma si ritenta (limite di
  // frequenza, passa aspettando), ma il credito finito no: si aspetterebbe
  // il doppio per ricevere identico rifiuto, e si raddoppierebbe il rumore
  // nei log su un guasto che si risolve solo ricaricando.
  let calls = 0;
  const quota = Object.assign(
    new Error('429 You have no credits remaining. Add credits to continue using the API.'),
    { status: 429 },
  );
  await assert.rejects(
    () => withOpenAIRetry(async () => { calls++; throw quota; }),
    /no credits remaining/,
  );
  assert.equal(calls, 1);
});
