// server/src/models/chains.js
// Motore di ricerca degli swap a catena (fase 2): trova cicli chiusi di
// esattamente 3 utenti tra gli annunci attivi e li propone via
// create_chain_proposal() (RPC Postgres, fase 1 — vedi
// supabase/migrations/20260712120000_swap_chains.sql).
//
// v1: un solo annuncio VENDO per utente considerato (se un utente ha più
// annunci attivi in VENDO, viene escluso dal grafo — evita l'ambiguità
// di "quale dei suoi annunci starebbe dando" finché non serve altro).
import { supabase } from "../db.js";
import { listActiveListings } from "./listings.js";
import { scoreChainCandidates, CHAIN_SCORE_PASS_THRESHOLD } from "../ai/chainMatch.js";
import { explainChain } from "../ai/chainExplain.js";

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
 * VENDO. Esclude i proprietari con 0 o >1 annunci VENDO attivi (v1: un
 * solo annuncio da dare a testa, per evitare ambiguità su quale annuncio
 * verrebbe usato nella catena).
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

  const singleVendoByOwner = new Map();
  for (const [owner, listings] of vendoByOwner) {
    if (listings.length === 1) singleVendoByOwner.set(owner, listings[0]);
  }

  return { singleVendoByOwner, cercoByOwner };
}

/**
 * Costruisce il grafo dei desideri: arco owner(A) -> owner(B) se A ha un
 * annuncio CERCO soddisfatto (score >= soglia) da un annuncio VENDO di B.
 * Solo proprietari con esattamente 1 annuncio VENDO attivo partecipano
 * (vedi groupListings).
 */
export async function buildDesireGraph(allActive) {
  const { singleVendoByOwner, cercoByOwner } = groupListings(allActive);
  const edges = new Map();

  for (const [owner, cercoListings] of cercoByOwner) {
    const myGive = singleVendoByOwner.get(owner);
    if (!myGive) continue; // niente da dare -> non può partecipare a una catena

    for (const want of cercoListings) {
      const candidates = [];
      for (const [otherOwner, vendo] of singleVendoByOwner) {
        if (otherOwner === owner) continue;
        if (vendo.type !== want.type) continue;
        candidates.push(vendo);
      }
      if (!candidates.length) continue;

      const scored = await scoreChainCandidates(want, candidates);
      for (const s of scored) {
        if (s.score < CHAIN_SCORE_PASS_THRESHOLD) continue;
        const candidateOwner = candidates.find((c) => c.id === s.id)?.user_id;
        if (!candidateOwner) continue;
        if (!edges.has(owner)) edges.set(owner, new Set());
        edges.get(owner).add(candidateOwner);
      }
    }
  }

  return { edges, singleVendoByOwner };
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

  const allActive = await listActiveListings({ limit: 1000 });
  const { edges, singleVendoByOwner } = await buildDesireGraph(allActive);
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

    const listingA = singleVendoByOwner.get(a);
    const listingB = singleVendoByOwner.get(b);
    const listingC = singleVendoByOwner.get(c);
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

  return {
    expiredChains: expiredCount,
    scannedListings: allActive.length,
    candidateOwners: singleVendoByOwner.size,
    cyclesFound: cycles.length,
    proposed,
    skipped,
    errors,
  };
}
