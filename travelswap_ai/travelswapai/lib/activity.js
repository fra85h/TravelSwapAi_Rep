// lib/activity.js — aggrega tutto ciò che "ti succede" in un unico posto
// (la casella Attività). Ogni fonte è best-effort: se una fallisce, le
// altre restano, così un errore di rete non svuota l'intera schermata.
import { listIncomingOffersAny, listOutgoingOffersAny } from "./offers";
import { listMyChainProposals } from "./chains";
import { listMyMatches } from "./savedSearches";
import { listMyTransactions } from "./transactions";
import { listMyChats } from "./chat";

// Stessi stati che lib/offers.js considera "pendenti": una proposta
// in_review deve comparire in Attività come una pending.
function isPending(status) {
  const s = String(status || "").toLowerCase();
  return s === "pending" || s === "in_review";
}

function isExpiredOffer(status) {
  return String(status || "").toLowerCase() === "expired";
}

// accepted/declined: la controparte ha risposto. "resolved" tiene solo le
// proposte INVIATE (outgoing) non ancora viste dal proponente
// (seenByProposer) — prima non esisteva alcun segnale per chi propone: se
// accettata o rifiutata, il flusso si fermava lì senza alcuna notifica.
function isResolvedOffer(status) {
  const s = String(status || "").toLowerCase();
  return s === "accepted" || s === "declined";
}

/**
 * Ritorna le sezioni della casella Attività:
 *  - toDo:     richiede una tua azione (proposte ricevute, catene da confermare)
 *  - waiting:  in attesa degli altri (proposte inviate ancora pending, catene già confermate)
 *  - resolved: proposte INVIATE appena accettate/rifiutate, non ancora viste
 *  - chats:    chat delle proposte accettate (con conteggio non letti)
 *  - found:    annunci trovati dai tuoi avvisi di ricerca
 *  - history:  scambi/vendite conclusi
 *  - expired:  proposte (ricevute o inviate) scadute senza risposta
 */
export async function loadActivity() {
  const [incoming, outgoing, chains, matches, tx, chats] = await Promise.all([
    listIncomingOffersAny().catch(() => []),
    listOutgoingOffersAny().catch(() => []),
    listMyChainProposals().catch(() => []),
    listMyMatches().catch(() => []),
    listMyTransactions().catch(() => []),
    listMyChats().catch(() => []),
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

  const resolved = [];
  outgoing.filter((o) => isResolvedOffer(o.status) && o.seenByProposer === false).forEach((o) =>
    resolved.push({ kind: "offer_out_resolved", id: "oor_" + o.id, sort: o.updated_at || o.created_at, data: o })
  );

  const found = matches.map((m) => ({
    kind: "match", id: "m_" + m.id, sort: m.matched_at, data: m,
  }));

  const history = tx.map((t) => ({
    kind: "tx", id: "t_" + t.id, sort: t.created_at, data: t,
  }));

  const expired = [];
  incoming.filter((o) => isExpiredOffer(o.status)).forEach((o) =>
    expired.push({ kind: "offer_in_expired", id: "oie_" + o.id, sort: o.updated_at || o.created_at, data: o })
  );
  outgoing.filter((o) => isExpiredOffer(o.status)).forEach((o) =>
    expired.push({ kind: "offer_out_expired", id: "ooe_" + o.id, sort: o.updated_at || o.created_at, data: o })
  );

  const byNewest = (a, b) => new Date(b.sort || 0) - new Date(a.sort || 0);
  [toDo, waiting, resolved, found, history, expired].forEach((arr) => arr.sort(byNewest));

  // Le chat arrivano già ordinate per ultimo messaggio (list_my_chats).
  const unreadChatCount = chats.reduce((n, c) => n + (c.unreadCount || 0), 0);

  return {
    toDo, waiting, resolved, found, history, expired, chats,
    toDoCount: toDo.length,
    resolvedCount: resolved.length,
    unreadChatCount,
  };
}
