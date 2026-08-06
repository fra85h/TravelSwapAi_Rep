// La verifica di allineamento fra repo e database deve restare vera.
//
// supabase/verify_schema.sql è generato dalle migration. Un file generato e
// committato ha un modo classico di rompersi: qualcuno aggiunge una
// migration, non rigenera, e il file continua a dire "tutto a posto"
// proprio per l'oggetto appena introdotto — cioè fallisce esattamente
// quando servirebbe.
//
// Il secondo test copre l'altra metà: ogni RPC che il codice chiama deve
// essere creata da qualche migration. Attenzione a cosa NON è — non
// avrebbe trovato il caso chain_disputes: quella migration nel repo c'era,
// semplicemente non era mai stata eseguita sul database. Quel buco lo trova
// solo verify_schema.sql lanciato contro il database vero. Qui si prende
// l'errore gemello, e più facile da fare: chiamare una funzione che nessuna
// migration crea affatto.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const generatore = path.join(repo, 'supabase', 'tools', 'gen_verify_schema.mjs');
const committato = path.join(repo, 'supabase', 'verify_schema.sql');

test('verify_schema.sql è aggiornato rispetto alle migration', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-')), 'out.sql');
  execFileSync(process.execPath, [generatore, '--out', tmp], { stdio: 'pipe' });

  const atteso = fs.readFileSync(tmp, 'utf8');
  const attuale = fs.readFileSync(committato, 'utf8');
  assert.equal(
    attuale,
    atteso,
    'supabase/verify_schema.sql non combacia con le migration: rigeneralo con\n' +
    '  node supabase/tools/gen_verify_schema.mjs',
  );
});

test('ogni RPC chiamata dal codice esiste in qualche migration', () => {
  const inventario = fs.readFileSync(committato, 'utf8');
  const dichiarate = new Set(
    [...inventario.matchAll(/\('funzione',\s*'([^']+)'\)/g)].map((m) => m[1]),
  );

  const chiamate = new Map(); // nome RPC -> file che la chiama
  const radici = [
    path.join(repo, 'server', 'src'),
    path.join(repo, 'travelswap_ai', 'travelswapai', 'lib'),
    path.join(repo, 'travelswap_ai', 'travelswapai', 'screens'),
  ];

  const visita = (dir) => {
    for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, voce.name);
      if (voce.isDirectory()) {
        if (voce.name === 'node_modules') continue;
        visita(p);
      } else if (/\.(js|mjs)$/.test(voce.name)) {
        const testo = fs.readFileSync(p, 'utf8');
        for (const m of testo.matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/gi)) {
          if (!chiamate.has(m[1])) chiamate.set(m[1], path.relative(repo, p));
        }
      }
    }
  };
  for (const r of radici) if (fs.existsSync(r)) visita(r);

  // Se questo elenco è vuoto il test non sta verificando niente: meglio
  // saperlo che avere un test verde per assenza di dati.
  assert.ok(chiamate.size > 10, `trovate solo ${chiamate.size} chiamate RPC: la scansione non funziona`);

  const orfane = [...chiamate.entries()]
    .filter(([nome]) => !dichiarate.has(nome))
    .map(([nome, file]) => `${nome} (chiamata da ${file})`);

  assert.deepEqual(orfane, [], 'RPC senza una migration che le crei:\n' + orfane.join('\n'));
});
