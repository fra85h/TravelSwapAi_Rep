// lib/chains.js — swap a catena (fase 4): lettura + conferma/rifiuto
import { supabase } from "./supabase";
import { getPublicProfilesByIds } from "./db";

/**
 * Le proposte di catena attive di cui l'utente corrente fa parte, con i
 * dati di tutti e 3 i partecipanti e gli annunci coinvolti già uniti.
 * Query in più passaggi con soli .eq()/.in() (nessun join annidato
 * PostgREST): più righe di codice ma nessuna sintassi da verificare
 * contro un progetto Supabase reale che qui non è disponibile.
 */
export async function listMyChainProposals() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: mine, error: e1 } = await supabase
    .from("chain_participants")
    .select("chain_id")
    .eq("user_id", user.id);
  if (e1) { console.log("[listMyChainProposals]", e1.message); return []; }

  const chainIds = Array.from(new Set((mine || []).map((r) => r.chain_id)));
  if (!chainIds.length) return [];

  const { data: chains, error: e2 } = await supabase
    .from("chain_proposals")
    .select("id, status, created_at, expires_at, explanation")
    .in("id", chainIds)
    .eq("status", "proposed");
  if (e2) { console.log("[listMyChainProposals]", e2.message); return []; }
  if (!chains || !chains.length) return [];

  const activeChainIds = chains.map((c) => c.id);

  const { data: participants, error: e3 } = await supabase
    .from("chain_participants")
    .select("chain_id, position, user_id, give_listing_id, receive_listing_id, confirmed, confirmed_at")
    .in("chain_id", activeChainIds);
  if (e3) { console.log("[listMyChainProposals]", e3.message); return []; }

  const listingIds = Array.from(new Set((participants || []).map((p) => p.give_listing_id)));
  let listingsById = new Map();
  if (listingIds.length) {
    const { data: listings, error: e4 } = await supabase
      .from("listings")
      .select("id, title, type, location, route_from, route_to, depart_at, arrive_at, check_in, check_out, price, image_url")
      .in("id", listingIds);
    if (e4) console.log("[listMyChainProposals]", e4.message);
    listingsById = new Map((listings || []).map((l) => [l.id, l]));
  }

  return chains
    .map((chain) => {
      const rows = (participants || [])
        .filter((p) => p.chain_id === chain.id)
        // Ordine DISCENDENTE per posizione: create_chain_proposal (vedi
        // 20260712120000_swap_chains.sql) valida che il receive di ognuno sia
        // il give del SUCCESSIVO in ordine di posizione, cioè la posizione
        // i riceve da (i+1)%3 — il flusso reale del dare va quindi "al
        // contrario" rispetto all'ordine crescente. Ordinando al contrario,
        // la freccia verso il basso tra una riga e la successiva (più il
        // richiudersi sull'ultima) rispecchia davvero chi dà a chi, invece
        // di suggerire la direzione opposta.
        .sort((a, b) => b.position - a.position)
        .map((p) => ({
          ...p,
          listing: listingsById.get(p.give_listing_id) || null,
          receiveListing: listingsById.get(p.receive_listing_id) || null,
          isMe: p.user_id === user.id,
        }));
      const confirmedCount = rows.filter((r) => r.confirmed).length;
      const mine = rows.find((r) => r.isMe) || null;
      return {
        ...chain,
        participants: rows,
        confirmedCount,
        myConfirmed: !!mine?.confirmed,
        myReceiveListing: mine?.receiveListing || null,
      };
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export async function confirmChain(chainId) {
  const { data, error } = await supabase.rpc("confirm_chain_participant", { p_chain_id: chainId });
  if (error) throw error;
  return data;
}

export async function declineChain(chainId) {
  const { data, error } = await supabase.rpc("decline_chain_participant", { p_chain_id: chainId });
  if (error) throw error;
  return data;
}

/**
 * Segnala un problema con UNO specifico degli altri partecipanti di una
 * catena COMPLETATA (non ha consegnato, il biglietto non era valido...).
 * Prima non esisteva nessun equivalente di reportExchangeProblem per le
 * catene a 3 — un solo partecipante disonesto danneggiava due persone
 * innocenti senza che nessuna delle due avesse modo di segnalarlo. Pubblica
 * il motivo in chat_chain, visibile a tutti e 3 nel thread.
 */
export async function reportChainProblem(chainId, accusedUserId, reason) {
  const { data, error } = await supabase.rpc("report_chain_problem", {
    p_chain_id: chainId,
    p_accused_id: accusedUserId,
    p_reason: String(reason || "").slice(0, 1000),
  });
  if (error) { console.log("[reportChainProblem]", error.message); throw new Error("Impossibile segnalare il problema"); }
  return data;
}

/**
 * Gli ALTRI partecipanti (io escluso) di una catena, con nome pubblico e
 * cosa danno — serve a ChainChatScreen per lasciar scegliere CONTRO CHI
 * segnalare un problema (reportChainProblem sopra richiede un accusedUserId
 * specifico, e listMyChainProposals() non copre le catene 'completed').
 * Best effort: in errore ritorna array vuoto, mai un'eccezione (la chat
 * resta comunque utilizzabile anche senza questa informazione).
 */
export async function getChainParticipants(chainId) {
  if (!chainId) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: rows, error } = await supabase
    .from("chain_participants")
    .select("user_id, give_listing_id")
    .eq("chain_id", chainId);
  if (error) { console.log("[getChainParticipants]", error.message); return []; }

  const others = (rows || []).filter((r) => r.user_id !== user.id);
  if (!others.length) return [];

  const listingIds = Array.from(new Set(others.map((r) => r.give_listing_id).filter(Boolean)));
  let listingsById = new Map();
  if (listingIds.length) {
    const { data: listings } = await supabase.from("listings").select("id, title").in("id", listingIds);
    listingsById = new Map((listings || []).map((l) => [l.id, l]));
  }

  let profilesById = new Map();
  try {
    const profiles = await getPublicProfilesByIds(others.map((r) => r.user_id));
    profilesById = new Map(profiles.map((p) => [String(p.id), p]));
  } catch {}

  return others.map((r) => {
    const profile = profilesById.get(String(r.user_id));
    return {
      userId: r.user_id,
      displayName: profile?.full_name || profile?.username || null,
      giveTitle: listingsById.get(r.give_listing_id)?.title || null,
    };
  });
}
