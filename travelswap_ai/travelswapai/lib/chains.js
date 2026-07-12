// lib/chains.js — swap a catena (fase 4): lettura + conferma/rifiuto
import { supabase } from "./supabase";

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
        .sort((a, b) => a.position - b.position)
        .map((p) => ({
          ...p,
          listing: listingsById.get(p.give_listing_id) || null,
          isMe: p.user_id === user.id,
        }));
      const confirmedCount = rows.filter((r) => r.confirmed).length;
      const mine = rows.find((r) => r.isMe) || null;
      return {
        ...chain,
        participants: rows,
        confirmedCount,
        myConfirmed: !!mine?.confirmed,
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
