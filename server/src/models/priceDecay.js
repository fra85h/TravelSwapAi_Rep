// server/src/models/priceDecay.js — decadimento automatico del prezzo
// ("prezzo dinamico") per gli annunci VENDO che l'hanno attivato.
//
// La curva è lineare negli ultimi PRICE_DECAY_WINDOW_DAYS giorni prima
// dell'evento (depart_at per i treni, check_in per gli hotel): da
// "list_price" (il prezzo di partenza, impostato dal client quando il
// venditore attiva il toggle o modifica il prezzo) fino a "price_floor"
// (il minimo, mai superato). Fuori da quella finestra il prezzo resta
// quello impostato dal venditore.
//
// Aggiorna SOLO "price" — tutto il resto del codice (matching, offerte,
// card) continua a leggerlo esattamente come oggi, zero modifiche altrove.
import { supabase } from "../db.js";
import { sendExpoPush } from "../lib/push.js";

const WINDOW_DAYS = Number(process.env.PRICE_DECAY_WINDOW_DAYS || 7);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function eventDate(listing) {
  const raw = listing.depart_at || listing.check_in;
  return raw ? new Date(raw) : null;
}

/**
 * Prezzo "target" secondo la curva, o null se mancano i dati per
 * calcolarlo (nessun evento, nessun list_price/price_floor).
 */
export function computeTargetPrice(listing, now = Date.now()) {
  const event = eventDate(listing);
  if (!event || Number.isNaN(event.getTime())) return null;

  const listPrice = listing.list_price == null ? null : Number(listing.list_price);
  const floor = listing.price_floor == null ? null : Number(listing.price_floor);
  if (listPrice == null || floor == null || Number.isNaN(listPrice) || Number.isNaN(floor)) return null;

  const daysToEvent = (event.getTime() - now) / MS_PER_DAY;
  if (daysToEvent >= WINDOW_DAYS) return listPrice;
  if (daysToEvent <= 0) return floor;

  const progress = (WINDOW_DAYS - daysToEvent) / WINDOW_DAYS; // 0 → 1
  const target = listPrice - (listPrice - floor) * progress;
  return Math.round(target * 100) / 100;
}

/**
 * Ricalcola il prezzo di tutti gli annunci active con dynamic pricing
 * attivo. Pensato per girare da un cron periodico (stesso schema di
 * chains.js/savedSearches.js): nessuna chiamata AI, tutto deterministico.
 */
export async function recomputeDynamicPrices() {
  if (!supabase) throw new Error("Supabase client not configured");

  const { data: listings, error } = await supabase
    .from("listings")
    .select("id, user_id, title, price, list_price, price_floor, depart_at, check_in, status")
    .eq("status", "active")
    .eq("dynamic_pricing_enabled", true)
    .not("price_floor", "is", null)
    .not("list_price", "is", null);
  if (error) throw error;

  let updated = 0;
  for (const listing of listings || []) {
    const target = computeTargetPrice(listing);
    if (target == null) continue;

    const current = Number(listing.price);
    // Mai far salire il prezzo, anche se "list_price" fosse disallineato
    // (vedi commento in migration): il decadimento è monotono, solo verso
    // il basso, e non scende mai sotto price_floor perché target è già
    // clampato lì dentro computeTargetPrice.
    const next = Math.min(current, target);
    if (!Number.isFinite(next) || Math.abs(next - current) < 0.01) continue;

    const { error: updErr } = await supabase
      .from("listings")
      .update({ price: next })
      .eq("id", listing.id)
      .eq("status", "active"); // ricontrollo: salta se nel frattempo non è più active
    if (updErr) {
      console.error("[priceDecay] update fallito per", listing.id, updErr.message);
      continue;
    }
    updated++;

    try {
      await supabase.from("notifications").insert({
        user_id: listing.user_id,
        type: "listing_price_dropped",
        title: "Prezzo sceso automaticamente",
        body: `«${listing.title || ""}» ora a ${next.toFixed(2)}€`,
        data: { listingId: listing.id, price: next, previousPrice: current },
      });
      sendExpoPush(listing.user_id, {
        title: "Prezzo sceso automaticamente",
        body: `«${listing.title || ""}» ora a ${next.toFixed(2)}€`,
        data: { type: "listing_price_dropped", listingId: listing.id },
      });
    } catch (e) {
      // Il prezzo è già aggiornato: se la notifica fallisce il venditore lo
      // vede comunque riaprendo il proprio annuncio.
      console.error("[priceDecay] notifica fallita per", listing.id, e?.message || e);
    }
  }

  return { checked: (listings || []).length, updated };
}
