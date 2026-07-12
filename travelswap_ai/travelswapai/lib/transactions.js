// lib/transactions.js — storico scambi/acquisti (tabella transactions)
import { supabase } from "./supabase";

/**
 * Le mie transazioni (sia come venditore che come acquirente), con i
 * dati essenziali dell'annuncio coinvolto. Ordinate dalla più recente.
 * Ogni riga include `direction`: "sold" se ero il venditore, "bought"
 * se ero l'acquirente (per lo swap, ogni utente vede la propria riga
 * come "bought" per l'annuncio ricevuto).
 */
export async function listMyTransactions() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, ttype, price, status, created_at, seller_id, buyer_id, listing:listing_id ( id, title, type, location, image_url )"
    )
    .or(`seller_id.eq.${user.id},buyer_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  if (error) { console.log("[listMyTransactions]", error.message); return []; }

  return (data || []).map((row) => ({
    ...row,
    direction: row.seller_id === user.id ? "sold" : "bought",
  }));
}
