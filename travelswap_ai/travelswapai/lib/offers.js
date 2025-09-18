
// lib/offers_v2.js — aggiornato per i flussi BUY/SWAP con helper RPC
import { supabase } from "./supabase";

/** Ritorna l'utente corrente o null */
async function getMe() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user ?? null;
}

/** Crea proposta di ACQUISTO (BUY) verso listingId */
export async function createOfferBuy(listingId, { amount, currency = "EUR", message } = {}) {
  const me = await getMe();
  if (!me) throw new Error("Non autenticato");
  const payload = {
    type: "buy",
    to_listing_id: listingId,
    from_listing_id: null,
    proposer_id: me.id,
    amount: amount ?? null,
    currency,
    message: message ?? null,
    status: "pending",
  };
  const { data, error } = await supabase.from("offers").insert([payload]).select().single();
  if (error) throw new Error(error.message || "Impossibile creare l'offerta");
  return data;
}

/** Crea proposta di SCAMBIO (SWAP): offro myListingId per ottenere targetListingId */
export async function createOfferSwap(myListingId, targetListingId, { message } = {}) {
  const me = await getMe();
  if (!me) throw new Error("Non autenticato");
  const payload = {
    type: "swap",
    from_listing_id: myListingId,
    to_listing_id: targetListingId,
    proposer_id: me.id,
    amount: null,
    currency: null,
    message: message ?? null,
    status: "pending",
  };
  const { data, error } = await supabase.from("offers").insert([payload]).select().single();
  if (error) throw new Error(error.message || "Impossibile creare l'offerta");
  return data;
}

/** Accetta offerta via RPC tollerante uuid/int */
export async function acceptOffer(offerId) {
  const { data, error } = await supabase.rpc("accept_offer_any", { offer_id_text: String(offerId) });
  if (error) throw new Error(error.message || "Impossibile accettare l'offerta");
  return data;
}

/** Rifiuta offerta via RPC tollerante uuid/int */
export async function declineOffer(offerId) {
  const { data, error } = await supabase.rpc("decline_offer_any", { offer_id_text: String(offerId) });
  if (error) throw new Error(error.message || "Impossibile rifiutare l'offerta");
  return data;
}

/** Cancella (proponente) la propria offerta pending */
export async function cancelOffer(offerId) {
  const { data, error } = await supabase
    .from("offers")
    .update({ status: "cancelled" })
    .eq("id", offerId)
    .eq("status", "pending")
    .select()
    .single();
  if (error) throw new Error(error.message || "Impossibile cancellare l'offerta");
  return data;
}

/** Offerte in entrata (verso i MIEI listing) - versione base (potrebbe soffrire mismatch tipi) */
export async function listIncomingOffers({ status } = {}) {
  const me = await getMe();
  if (!me) throw new Error("Non autenticato");
  let q = supabase
    .from("offers")
    .select(`
      id,type,status,message,amount,currency,created_at,updated_at,
      from_listing:from_listing_id ( id,title,user_id ),
      to_listing:to_listing_id ( id,title,user_id )
    `)
    .order("created_at", { ascending: false });

  q = q.eq("to_listing.user_id", me.id);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message || "Impossibile caricare le offerte");
  return data || [];
}

/** Offerte collegate a un singolo listing (entrata/uscita) */
export async function listOffersForListing(listingId) {
  const { data, error } = await supabase
    .from("offers")
    .select(`
      id,type,status,message,amount,currency,created_at,
      from_listing:from_listing_id ( id,title,user_id ),
      to_listing:to_listing_id ( id,title,user_id )
    `)
    .or(`from_listing_id.eq.${listingId},to_listing_id.eq.${listingId}`)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message || "Impossibile caricare le offerte");
  return data || [];
}

/** Helper RPC: pending personale verso un listing (evita mismatch uuid/int) */
export async function getMyPendingOfferFor(listingId) {

const { data, error } = await supabase.rpc("get_my_pending_offer_any", {
listing_id_text: String(listingId)
 });
 if (error) throw new Error(error.message || "Errore nel controllo proposta esistente");

  // Consideriamo "pendente" solo stati effettivamente pendenti
  const PENDING_STATES = new Set(["pending", "in_review"]);
  const norm = (s) => String(s ?? "").trim().toLowerCase();

  // L'RPC può tornare null, {} o una riga; accettiamo solo se realmente pendente
  if (!data || typeof data !== "object") return null;
  const status = norm(data.status);
  return PENDING_STATES.has(status) ? data : null;

}

/** Helper RPC: lista annunci attivi dell'utente (per SWAP) */
export async function listMyActiveListings() {
  const { data, error } = await supabase.rpc("list_my_active_listings");
  if (error) throw new Error(error.message || "Impossibile caricare i tuoi annunci");
  return data || [];
}
export async function listOffersForListingOwner(listingId) {
  const { data, error } = await supabase
    .from("offers")
    .select(`
      id,type,status,message,amount,currency,created_at,proposer_id,
      from_listing:from_listing_id ( id,title,user_id ),
      to_listing:to_listing_id   ( id,title,user_id )
    `)
    .eq("to_listing_id", listingId)              // 👈 ricevute
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message || "Impossibile caricare le offerte ricevute");
  return data || [];
}

// (facoltativo) Funzione “all around” per non-owner (mostra sia da/verso)
export async function listOffersForListingAround(listingId) {
  const { data, error } = await supabase
    .from("offers")
    .select(`
      id,type,status,message,amount,currency,created_at,proposer_id,
      from_listing:from_listing_id ( id,title,user_id ),
      to_listing:to_listing_id   ( id,title,user_id )
    `)
    .or(`from_listing_id.eq.${listingId},to_listing_id.eq.${listingId}`)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message || "Impossibile caricare le offerte");
  return data || [];
}