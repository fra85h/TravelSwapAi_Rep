// Threat-modeling fase post-transazione (sezione A, punto 5, ultimo dei 5):
// prima chi aveva già confermato 2/3 di una catena non riceveva alcun
// segnale diverso da un silenzio totale fino alla scadenza (48h). Verifica
// che findAndProposeChains() (server/src/models/chains.js), già agganciata
// al cron a 15 minuti di /api/chains/recompute, chiami ANCHE la nuova
// remind_stale_chain_confirmers oltre a expire_old_chain_proposals — non la
// logica SQL in sé (coperta da migrationsIntegrity.test.js), solo che il
// nuovo passaggio sia davvero agganciato al ciclo esistente.
//
// listActiveListings mockato a lista vuota: fa terminare rapidamente il
// resto della funzione (nessun ciclo da cercare) senza dover simulare tutto
// il motore di matching — le due RPC di manutenzione girano comunque PRIMA,
// in cima alla funzione.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('findAndProposeChains chiama remind_stale_chain_confirmers oltre a expire_old_chain_proposals', async () => {
  const calledRpc = [];
  mock.module('../src/db.js', {
    namedExports: {
      supabase: {
        rpc: async (fn) => {
          calledRpc.push(fn);
          if (fn === 'expire_old_chain_proposals') return { data: 1, error: null };
          if (fn === 'remind_stale_chain_confirmers') return { data: 2, error: null };
          return { data: null, error: null };
        },
        from: () => ({
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        }),
      },
    },
  });
  mock.module('../src/models/listings.js', {
    namedExports: { listActiveListings: async () => [] },
  });

  const { findAndProposeChains } = await import('../src/models/chains.js');
  const out = await findAndProposeChains();

  assert.deepEqual(calledRpc, ['expire_old_chain_proposals', 'remind_stale_chain_confirmers']);
  assert.equal(out.expiredChains, 1);
  assert.equal(out.remindedChains, 2);

  mock.reset();
});
