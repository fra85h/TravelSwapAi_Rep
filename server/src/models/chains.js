// server/src/models/chains.js
// Motore di ricerca degli swap a catena (fase 2): trova cicli chiusi di
// esattamente 3 utenti tra gli annunci attivi e li propone via
// create_chain_proposal() (RPC Postgres, fase 1 — vedi
// supabase/migrations/20260712120000_swap_chains.sql).
//
// v2: un utente con più annunci VENDO attivi partecipa comunque al grafo.
// L'ambiguità "quale dei suoi annunci starebbe dando" si risolve a livello
// di singolo arco, non di utente: ogni arco owner(A)->owner(B) memorizza lo
// SPECIFICO annuncio di B che soddisfa il CERCO di A (il migliore per
// punteggio, se più di uno passa la soglia). create_chain_proposal() valida
// comunque lato DB che ogni give_listing sia posseduto da chi lo dichiara e
// sia active, quindi qui basta essere coerenti sull'id scelto.
import { supabase } from "../db.js";
import { listActiveListings } from "./listings.js";
import { scoreChainCandidates, CHAIN_SCORE_PASS_THRESHOLD, worthScoringByDate, CHAIN_DATE_WINDOW_DAYS } from "../ai/chainMatch.js";
import { explainChain } from "../ai/chainExplain.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { chainFingerprint, canSkipRecompute } from "../lib/chainFingerprint.js";

// Valutazioni AI dei candidati in volo contemporaneamente. Basso: ognuna può
// a sua volta spezzarsi in più batch (vedi CHAIN_AI_CONCURRENCY in
// ai/chainMatch.js), quindi le due concorrenze si moltiplicano.
const CHAIN_SCORE_CONCURRENCY = Number(process.env.CHAIN_SCORE_CONCURRENCY ?? 3);

/**
 * Trova cicli diretti di lunghezza esatta 3 in un grafo { ownerId: Set<ownerId> }.
 * Pura e sincrona: nessuna I/O, per essere testabile senza mock di rete/DB.
 * Ritorna un array di terne [a, b, c] (a->b->c->a), senza duplicati
 * (stessa terna in rotazioni diverse conta una sola volta).
 */
export function findThreeCycles(edges) {
  const cycles = [];
  const seen = new Set();

  for (const a of edges.keys()) {
    const bs = edges.get(a) || new Set();
    for (const b of bs) {
      if (b === a) continue;
      const cs = edges.get(b) || new Set();
      for (const c of cs) {
        if (c === a || c === b) continue;
        const as = edges.get(c) || new Set();
        if (!as.has(a)) continue;

        // Chiave canonica: ruota la terna per iniziare dall'elemento minimo,
        // mantenendo l'ORDINE. `.sort()` scartava anche la direzione, non
        // solo il punto di partenza: confondeva a->b->c->a (rotazione, stesso
        // ciclo) con a->c->b->a (direzione opposta, un altro scambio con
        // dare/ricevere invertiti) se esistevano entrambe le triple di archi.
        const triple = [a, b, c];
        const minIdx = triple.indexOf(triple.slice().sort()[0]);
        const key = [...triple.slice(minIdx), ...triple.slice(0, minIdx)].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        cycles.push([a, b, c]);
      }
    }
  }
  return cycles;
}

/**
 * Raggruppa gli annunci attivi per proprietario, tenendo solo i CERCO e i
 * VENDO. Nessun limite sul numero di annunci VENDO per proprietario: un
 * utente con più annunci attivi in VENDO partecipa comunque, con tutti i
 * suoi annunci come candidati.
 */
function groupListings(allActive) {
  const vendoByOwner = new Map();
  const cercoByOwner = new Map();

  for (const l of allActive) {
    if (l.cerco_vendo === "VENDO") {
      if (!vendoByOwner.has(l.user_id)) vendoByOwner.set(l.user_id, []);
      vendoByOwner.get(l.user_id).push(l);
    } else if (l.cerco_vendo === "CERCO") {
      if (!cercoByOwner.has(l.user_id)) cercoByOwner.set(l.user_id, []);
      cercoByOwner.get(l.user_id).push(l);
    }
  }

  return { vendoByOwner, cercoByOwner };
}

/**
 * Costruisce il grafo dei desideri: arco owner(A) -> owner(B) se A ha un
 * annuncio CERCO soddisfatto (score >= soglia) da un annuncio VENDO di B.
 * Ogni proprietario con almeno un VENDO e un CERCO attivi partecipa, anche
 * se possiede più annunci VENDO (vedi groupListings). `bestEdgeListing`
 * risolve l'ambiguità "quale dei suoi annunci": tiene, per ogni coppia
 * ordinata (A, B), il candidato di B con punteggio più alto tra quelli di B
 * che soddisfano un CERCO di A.
 */
export async function buildDesireGraph(allActive) {
  const { vendoByOwner, cercoByOwner } = groupListings(allActive);
  const edges = new Map();
  const bestEdgeListing = new Map(); // key `${fromOwner}|${toOwner}` -> { listingId, score }

  // I VENDO raggruppati per tipo una volta sola: prima ogni annuncio CERCO
  // riscorreva l'INTERA mappa dei VENDO per filtrarli per tipo, cioè
  // O(cerco × vendo) scansioni ripetute sugli stessi dati a ogni ricalcolo.
  const allVendo = [...vendoByOwner.values()].flat();
  const vendoByType = new Map();
  for (const vendo of allVendo) {
    if (!vendoByType.has(vendo.type)) vendoByType.set(vendo.type, []);
    vendoByType.get(vendo.type).push(vendo);
  }
  // id -> proprietario: `candidates.find(...)` dentro il ciclo sui punteggi
  // era una ricerca lineare per ogni risultato, O(n²) sul lotto di candidati.
  const ownerByListingId = new Map(allVendo.map((v) => [String(v.id), v.user_id]));

  // Una coppia (annuncio CERCO, lotto di candidati) per ogni valutazione:
  // scoreChainCandidates è una chiamata OpenAI e prima venivano fatte tutte
  // in fila, una per annuncio CERCO dell'intera piattaforma.
  // Pre-filtro deterministico PRIMA di chiamare l'AI.
  //
  // Il numero di chiamate cresce come CERCO x VENDO: con 333 annunci un
  // giro costava 7 centesimi, e la crescita è quadratica — a 1000 annunci
  // non sarebbe il triplo, sarebbe circa dieci volte tanto. Mandare al
  // modello un candidato con data a tre mesi di distanza costa esattamente
  // quanto mandargliene uno buono, per farsi dire una cosa che sapevamo
  // già.
  //
  // Si filtra solo sulla DATA, che è un fatto misurabile. La vicinanza fra
  // due città è un giudizio, ed è il motivo per cui qui c'è un modello:
  // filtrarla con la mappa statica delle regioni annullerebbe il senso
  // dell'AI. Vedi worthScoringByDate in ai/chainMatch.js.
  let scartatiPerData = 0;
  const jobs = [];
  for (const [owner, cercoListings] of cercoByOwner) {
    if (!vendoByOwner.has(owner)) continue; // niente da dare -> fuori dalle catene
    for (const want of cercoListings) {
      const sameType = (vendoByType.get(want.type) || []).filter((v) => v.user_id !== owner);
      const candidates = sameType.filter((v) => worthScoringByDate(want, v));
      scartatiPerData += sameType.length - candidates.length;
      if (candidates.length) jobs.push({ owner, want, candidates });
    }
  }
  if (scartatiPerData) {
    console.log(`[chains] ${scartatiPerData} candidati fuori dalla finestra di ${CHAIN_DATE_WINDOW_DAYS} giorni: non inviati all'AI`);
  }

  const scoredJobs = await mapWithConcurrency(
    jobs,
    CHAIN_SCORE_CONCURRENCY,
    async ({ want, candidates }) => scoreChainCandidates(want, candidates)
  );

  scoredJobs.forEach((scored, i) => {
    const { owner } = jobs[i];
    for (const s of scored || []) {
      if (s.score < CHAIN_SCORE_PASS_THRESHOLD) continue;
      const candidateOwner = ownerByListingId.get(String(s.id));
      if (!candidateOwner) continue;
      if (!edges.has(owner)) edges.set(owner, new Set());
      edges.get(owner).add(candidateOwner);

      const key = `${owner}|${candidateOwner}`;
      const prev = bestEdgeListing.get(key);
      if (!prev || s.score > prev.score) {
        bestEdgeListing.set(key, { listingId: s.id, score: s.score });
      }
    }
  });

  return { edges, bestEdgeListing, listingById: new Map(allVendo.map((v) => [String(v.id), v])) };
}

/**
 * Utenti già coinvolti in una catena 'proposed' (per non riproporli finché
 * quella non si chiude/decade/scade).
 */
async function ownersWithPendingChain() {
  const { data: pendingChains, error: err1 } = await supabase
    .from("chain_proposals")
    .select("id")
    .eq("status", "proposed");
  if (err1) throw err1;

  const chainIds = (pendingChains || []).map((c) => c.id);
  if (!chainIds.length) return new Set();

  const { data: participants, error: err2 } = await supabase
    .from("chain_participants")
    .select("user_id")
    .in("chain_id", chainIds);
  if (err2) throw err2;

  return new Set((participants || []).map((r) => r.user_id));
}

/**
 * Entry point: trova cicli di 3 tra gli annunci attivi e propone una
 * chain_proposal per ognuno (via RPC service-role). Ritorna un riepilogo,
 * non lancia eccezioni per un singolo ciclo fallito (continua con gli altri).
 */
// Impronta dell'ultimo ricalcolo COMPLETATO. In memoria di proposito: se il
// server riparte si perde e si fa un ricalcolo in più, che costa una volta;
// una colonna nuova costerebbe una migration da eseguire a mano per sempre.
let lastFingerprint = null;

/**
 * Conteggio e data più recente di una tabella, senza rileggerne le righe:
 * due numeri presi con una query di aggregazione.
 *
 * La colonna della data è un parametro perché le due tabelle non sono
 * uguali: `listings` ha `updated_at` (mantenuta da un trigger), mentre
 * `chain_proposals` ha solo `created_at` — verificato, non assunto. Su
 * quest'ultima il segnale del cambiamento è il CONTEGGIO delle catene
 * ancora 'proposed': quando una si chiude, decade o scade, quel numero
 * cala e i suoi partecipanti tornano disponibili per cicli nuovi. Due
 * variazioni opposte nello stesso quarto d'ora (una si chiude, una nasce)
 * lascerebbero il conteggio uguale, ma la data più recente cambia — le
 * righe nuove nascono sempre con `now()`.
 */
async function tableStamp(table, dateColumn, filter) {
  let q = supabase.from(table).select(dateColumn, { count: "exact" })
    .order(dateColumn, { ascending: false }).limit(1);
  if (filter) q = filter(q);
  const { data, count, error } = await q;
  if (error) throw error;
  return { count: count ?? 0, lastChangeAt: data?.[0]?.[dateColumn] ?? null };
}

/** Solo per i test: dimentica l'ultimo giro. */
export function __resetChainFingerprintForTests() {
  lastFingerprint = null;
}

export async function findAndProposeChains() {
  if (!supabase) throw new Error("Supabase client not configured");

  // Manutenzione nella stessa chiamata: chi triggera questo endpoint
  // periodicamente non deve configurare un secondo meccanismo solo per
  // scadere le catene rimaste in sospeso troppo a lungo (expires_at, 48h).
  let expiredCount = 0;
  const { data: expireResult, error: expireErr } = await supabase.rpc("expire_old_chain_proposals");
  if (expireErr) {
    console.error("[chains] expire_old_chain_proposals failed:", expireErr.message);
  } else {
    expiredCount = expireResult ?? 0;
  }

  // Protezione per chi conferma per primo (threat-modeling fase
  // post-transazione, sezione A punto 5): prima chi aveva già confermato
  // 2/3 di una catena non riceveva alcun segnale diverso da un silenzio
  // totale fino alla scadenza delle 48h. Stesso agganciamento al cron di
  // expire_old_chain_proposals qui sopra: un promemoria per catena,
  // reminder_sent_at evita di rispedirlo ogni 15 minuti.
  let remindedCount = 0;
  const { data: remindResult, error: remindErr } = await supabase.rpc("remind_stale_chain_confirmers");
  if (remindErr) {
    console.error("[chains] remind_stale_chain_confirmers failed:", remindErr.message);
  } else {
    remindedCount = remindResult ?? 0;
  }

  // Si può saltare tutto il resto? Il grafo dei desideri dipende da due
  // cose sole — gli annunci attivi e le catene in sospeso — e se nessuna
  // delle due si è mossa il risultato sarebbe identico a quello di 15
  // minuti fa. Le due chiamate di manutenzione qui sopra sono già state
  // fatte: quelle dipendono dal passare del tempo, non dagli annunci, e
  // saltarle romperebbe scadenze e promemoria.
  try {
    const [listingsStamp, chainsStamp] = await Promise.all([
      tableStamp("listings", "updated_at", (q) => q.eq("status", "active")),
      // Stesso filtro di ownersWithPendingChain: sono le catene 'proposed'
      // a bloccare i loro partecipanti, e quindi le sole che cambiano il
      // risultato del ricalcolo.
      tableStamp("chain_proposals", "created_at", (q) => q.eq("status", "proposed")),
    ]);
    const fingerprint = chainFingerprint(listingsStamp, chainsStamp);
    if (canSkipRecompute(lastFingerprint, fingerprint, expiredCount)) {
      console.log("[chains] nessun cambiamento dall'ultimo giro, ricalcolo saltato:", fingerprint);
      return { proposed: [], skipped: [], errors: [], expiredCount, remindedCount, unchanged: true };
    }
    lastFingerprint = fingerprint;
  } catch (e) {
    // Se l'impronta non si riesce a leggere si ricalcola, come prima: il
    // risparmio è un di più, non deve poter impedire il lavoro vero.
    console.warn("[chains] impronta non leggibile, si ricalcola:", e?.message || e);
  }

  const allActive = await listActiveListings({ limit: 1000 });
  const { edges, bestEdgeListing, listingById } = await buildDesireGraph(allActive);
  const cycles = findThreeCycles(edges);

  const pending = await ownersWithPendingChain();
  const proposed = [];
  const skipped = [];
  const errors = [];

  for (const [a, b, c] of cycles) {
    if (pending.has(a) || pending.has(b) || pending.has(c)) {
      skipped.push({ owners: [a, b, c], reason: "owner already in a pending chain" });
      continue;
    }

    // Per ogni proprietario, l'annuncio SPECIFICO che dà in questo ciclo:
    // quello che soddisfa il CERCO del proprietario precedente nel ciclo
    // (arco precedente->questo). Con più annunci VENDO per proprietario,
    // ognuno può usarne uno diverso a seconda del ciclo trovato.
    const giveA = bestEdgeListing.get(`${c}|${a}`); // il CERCO di c è soddisfatto dal VENDO di a
    const giveB = bestEdgeListing.get(`${a}|${b}`); // il CERCO di a è soddisfatto dal VENDO di b
    const giveC = bestEdgeListing.get(`${b}|${c}`); // il CERCO di b è soddisfatto dal VENDO di c
    if (!giveA || !giveB || !giveC) continue; // non dovrebbe succedere se il ciclo esiste negli edges

    const listingA = listingById.get(String(giveA.listingId));
    const listingB = listingById.get(String(giveB.listingId));
    const listingC = listingById.get(String(giveC.listingId));
    if (!listingA || !listingB || !listingC) continue;

    const participants = [
      { user_id: a, give_listing_id: listingA.id, receive_listing_id: listingB.id },
      { user_id: b, give_listing_id: listingB.id, receive_listing_id: listingC.id },
      { user_id: c, give_listing_id: listingC.id, receive_listing_id: listingA.id },
    ];

    const { data, error } = await supabase.rpc("create_chain_proposal", {
      p_participants: participants,
    });

    if (error) {
      errors.push({ owners: [a, b, c], error: error.message });
      continue;
    }

    proposed.push({ chainId: data, owners: [a, b, c] });
    // evita di riusare gli stessi 3 utenti in un altro ciclo trovato in questo stesso giro
    pending.add(a);
    pending.add(b);
    pending.add(c);

    // Spiegazione in linguaggio naturale (fase 3): non blocca la proposta
    // se fallisce, la catena resta valida senza `explanation` (il client
    // può comunque mostrare i dati grezzi dei 3 annunci).
    try {
      const explanation = await explainChain([listingA, listingB, listingC]);
      const { error: explErr } = await supabase
        .from("chain_proposals")
        .update({ explanation })
        .eq("id", data);
      if (explErr) console.error("[chains] failed to save explanation:", explErr.message);
    } catch (e) {
      console.error("[chains] explainChain failed:", e?.message || e);
    }
  }

  const candidateOwners = new Set([...listingById.values()].map((v) => v.user_id));

  return {
    expiredChains: expiredCount,
    remindedChains: remindedCount,
    scannedListings: allActive.length,
    candidateOwners: candidateOwners.size,
    cyclesFound: cycles.length,
    proposed,
    skipped,
    errors,
  };
}
