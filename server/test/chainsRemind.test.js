// Threat-modeling fase post-transazione (sezione A, punto 5, ultimo dei 5):
// prima chi aveva già confermato 2/3 di una catena non riceveva alcun
// segnale diverso da un silenzio totale fino alla scadenza (48h). Verifica
// che findAndProposeChains() (server/src/models/chains.js), già agganciata
// al cron a 15 minuti di /api/chains/recompute, chiami ANCHE la nuova
// remind_stale_chain_confirmers oltre a expire_old_chain_proposals.
//
// Controllo sul TESTO sorgente (stesso principio delle regressioni SQL di
// migrationsIntegrity.test.js), non un import+mock del modulo: chains.js
// importa (indirettamente) l'SDK OpenAI via ai/chainMatch.js, e mock.module
// + --experimental-test-module-mocks su quella catena di import va in
// conflitto con web-streams-polyfill sotto Node 20 (non sotto 22) — un
// problema di infrastruttura di test, non del codice applicativo. La
// logica SQL reale di remind_stale_chain_confirmers è già coperta da
// migrationsIntegrity.test.js; qui basta verificare che sia davvero
// AGGANCIATA al ciclo esistente, non riscriverne l'esecuzione.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'models', 'chains.js'),
  'utf8',
);

test('findAndProposeChains chiama remind_stale_chain_confirmers oltre a expire_old_chain_proposals', () => {
  assert.match(SOURCE, /supabase\.rpc\(\s*"expire_old_chain_proposals"\s*\)/,
    'manca la chiamata a expire_old_chain_proposals');
  assert.match(SOURCE, /supabase\.rpc\(\s*"remind_stale_chain_confirmers"\s*\)/,
    'manca la chiamata a remind_stale_chain_confirmers: il promemoria non è più agganciato al cron a 15 minuti');
  // Ordine: la maintenance (expire + remind) deve girare PRIMA della
  // ricerca cicli, non dopo — altrimenti un promemoria mancato o in
  // ritardo non è mai un problema di logica, ma di questo aggancio.
  const expireIdx = SOURCE.indexOf('expire_old_chain_proposals');
  const remindIdx = SOURCE.indexOf('remind_stale_chain_confirmers');
  assert.ok(expireIdx >= 0 && remindIdx > expireIdx,
    'remind_stale_chain_confirmers non è più chiamata subito dopo expire_old_chain_proposals');

  assert.match(SOURCE, /remindedChains:\s*remindedCount/,
    'il riepilogo di findAndProposeChains non espone più remindedChains (osservabilità del cron)');
});
