// lib/activity.js — aggrega tutto ciò che "ti succede" in un unico posto
// (la casella Attività). Ogni fonte è best-effort: se una fallisce, le
// altre restano, così un errore di rete non svuota l'intera schermata.
import { listIncomingOffersAny, listOutgoingOffersAny } from "./offers";
import { listMyChainProposals } from "./chains";
import { listMyMatches } from "./savedSearches";
import { listMyTransactions } from "./transactions";

// Stessi stati che lib/offers.js considera "pendenti": una proposta
// in_review deve comparire in Attività come una pending.
function isPending(status) {
  const s = String(status || "").toLowerCase();
  return s === "pending" || s === "in_review";
}

/**
 * Ritorna le quattro sezioni della casella Attività:
 *  - toDo:    richiede una tua azione (proposte ricevute, catene da confermare)
 *  - waiting: in attesa degli altri (proposte inviate, catene già confermate)
 *  - found:   annunci trovati dai tuoi avvisi di ricerca
 *  - history: scambi/vendite conclusi
 */
export async function loadActivity() {
  const [incoming, outgoing, chains, matches, tx] = await Promise.all([
    listIncomingOffersAny().catch(() => []),
    listOutgoingOffersAny().catch(() => []),
    listMyChainProposals().catch(() => []),
    listMyMatches().catch(() => []),
    listMyTransactions().catch(() => []),
  ]);

  const toDo = [];
  incoming.filter((o) => isPending(o.status)).forEach((o) =>
    toDo.push({ kind: "offer_in", id: "oi_" + o.id, sort: o.created_at, data: o })
  );
  chains.filter((c) => !c.myConfirmed).forEach((c) =>
    toDo.push({ kind: "chain", id: "ch_" + c.id, sort: c.created_at, data: c })
  );

  const waiting = [];
  outgoing.filter((o) => isPending(o.status)).forEach((o) =>
    waiting.push({ kind: "offer_out", id: "oo_" + o.id, sort: o.created_at, data: o })
  );
  chains.filter((c) => c.myConfirmed).forEach((c) =>
    waiting.push({ kind: "chain_waiting", id: "cw_" + c.id, sort: c.created_at, data: c })
  );

  const found = matches.map((m) => ({
    kind: "match", id: "m_" + m.id, sort: m.matched_at, data: m,
  }));

  const history = tx.map((t) => ({
    kind: "tx", id: "t_" + t.id, sort: t.created_at, data: t,
  }));

  const byNewest = (a, b) => new Date(b.sort || 0) - new Date(a.sort || 0);
  [toDo, waiting, found, history].forEach((arr) => arr.sort(byNewest));

  return { toDo, waiting, found, history, toDoCount: toDo.length };
}
