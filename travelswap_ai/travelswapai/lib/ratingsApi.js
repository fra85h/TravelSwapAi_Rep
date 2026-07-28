// lib/ratingsApi.js — valutazioni 1–5 stelle a transazione conclusa.
//
// Tutto passa dalle RPC: la tabella non è raggiungibile dai ruoli pubblici.
// Il double-blind vive in SQL (get_user_rating conta solo i voti rivelati),
// quindi da qui non c'è modo di leggere il voto fresco dell'altra parte.
import { supabase } from "./supabase";

/** Aggregato pubblico: { avg: number|null, count: number }. */
export async function getUserRating(userId) {
  if (!userId) return { avg: null, count: 0 };
  const { data, error } = await supabase.rpc("get_user_rating", { p_user_id: userId });
  if (error) {
    // count: null e non 0 — "non lo sappiamo" non è "zero voti". Con 0 il
    // badge mostrerebbe "Nuovo" su un utente che magari ha trenta scambi,
    // solo perché la lettura è fallita.
    console.log("[getUserRating]", error.message);
    return { avg: null, count: null };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    avg: row?.avg_stars != null ? Number(row.avg_stars) : null,
    count: Number(row?.ratings_count ?? 0),
  };
}

/** Il mio voto su questa transazione, o null se non ho ancora votato. */
export async function myRatingForOffer(offerId) {
  if (!offerId) return null;
  const { data, error } = await supabase.rpc("my_rating_for_offer", {
    p_offer_id: Number(offerId),
  });
  if (error) {
    console.log("[myRatingForOffer]", error.message);
    return null;
  }
  const n = Number(data);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Vota (1–5). Immutabile: un voto diverso dal primo viene rifiutato dal DB. */
export async function rateTransaction(offerId, stars) {
  const { data, error } = await supabase.rpc("rate_transaction", {
    p_offer_id: Number(offerId),
    p_stars: Number(stars),
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
