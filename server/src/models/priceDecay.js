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

// Quanto deve essere sceso il prezzo, rispetto all'ultima volta che li
// abbiamo avvisati, perché valga la pena avvisare di nuovo chi ha salvato
// l'annuncio. Il cron gira spesso e la curva scende a piccoli passi: senza
// una soglia si manderebbe una notifica per ogni centesimo, e il primo
// effetto sarebbe che la gente le disattiva tutte.
const SOGLIA_AVVISO = Number(process.env.SAVER_NOTIFY_DROP_PCT || 0.05);

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
 * Vale la pena avvisare chi ha salvato l'annuncio?
 *
 * Il riferimento è l'ultimo prezzo che abbiamo annunciato a costoro
 * (savers_notified_price); la prima volta è il prezzo di partenza della
 * curva (list_price). Si avvisa solo se il nuovo prezzo è sceso almeno di
 * SOGLIA_AVVISO rispetto a quel riferimento.
 *
 * Il caso del venditore che RIALZA il prezzo si corregge da sé: se il prezzo
 * attuale è più alto dell'ultimo annunciato, quell'annuncio è ormai vecchio
 * e si riparte da list_price. Senza questo controllo un ri-ancoraggio verso
 * l'alto avrebbe zittito le notifiche per sempre, perché il riferimento
 * sarebbe rimasto a un valore che il prezzo non tocca più.
 *
 * Funzione pura ed esportata perché è la regola che decide se una persona
 * riceve o no una notifica: va potuta provare da sola.
 */
export function deveAvvisareChiHaSalvato(listing, next, soglia = SOGLIA_AVVISO) {
  const listPrice = listing?.list_price == null ? null : Number(listing.list_price);
  const ultimo = listing?.savers_notified_price == null ? null : Number(listing.savers_notified_price);
  const attuale = Number(listing?.price);

  let riferimento = ultimo;
  if (riferimento == null || Number.isNaN(riferimento)) riferimento = listPrice;
  else if (Number.isFinite(attuale) && attuale > riferimento) riferimento = listPrice;

  if (riferimento == null || Number.isNaN(riferimento) || riferimento <= 0) return false;
  if (!Number.isFinite(next)) return false;
  return next <= riferimento * (1 - soglia);
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
    .select("id, user_id, title, price, list_price, price_floor, depart_at, check_in, status, savers_notified_price")
    .eq("status", "active")
    .eq("dynamic_pricing_enabled", true)
    .not("price_floor", "is", null)
    .not("list_price", "is", null);
  if (error) throw error;

  let updated = 0;
  // Annunci per cui il ribasso è abbastanza grosso da meritare un avviso a
  // chi li ha salvati. Si raccolgono qui e si notificano tutti insieme dopo
  // il ciclo: una query per leggere chi ha salvato cosa invece di una per
  // annuncio.
  const daAnnunciare = [];

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

    // La decisione si prende PRIMA della scrittura, così il nuovo prezzo e
    // la memoria dell'avviso vanno a DB nella stessa update: non esiste un
    // istante in cui il prezzo è sceso ma il riferimento anti-spam è ancora
    // quello vecchio.
    const avvisaSalvati = deveAvvisareChiHaSalvato(listing, next);

    let scrittura = supabase
      .from("listings")
      .update(avvisaSalvati ? { price: next, savers_notified_price: next } : { price: next })
      .eq("id", listing.id)
      .eq("status", "active"); // ricontrollo: salta se nel frattempo non è più active

    // Compare-and-set sul riferimento anti-spam: la scrittura passa solo se
    // savers_notified_price è ancora quello che abbiamo letto poco fa. Il
    // turno in withCronLease dovrebbe già impedire due giri insieme, ma un
    // turno ha una scadenza e questo controllo no: se per qualunque motivo
    // due esecuzioni si accavallano, la seconda non trova più il valore che
    // si aspettava, non scrive, e nessuno riceve due volte la stessa
    // notifica di calo prezzo.
    if (avvisaSalvati) {
      scrittura = listing.savers_notified_price == null
        ? scrittura.is("savers_notified_price", null)
        : scrittura.eq("savers_notified_price", listing.savers_notified_price);
    }

    // `.select()` non serve per leggere: serve per SAPERE se la riga è stata
    // toccata. Senza, un update che non trova nulla è indistinguibile da uno
    // riuscito, e il fan-out partirebbe lo stesso.
    const { data: righeToccate, error: updErr } = await scrittura.select("id");
    if (updErr) {
      console.error("[priceDecay] update fallito per", listing.id, updErr.message);
      continue;
    }
    if (!Array.isArray(righeToccate) || righeToccate.length === 0) {
      // Nessuna riga: l'annuncio non è più attivo, oppure un altro giro ha
      // già fatto questo lavoro. In entrambi i casi qui non c'è niente da
      // annunciare.
      continue;
    }
    updated++;
    if (avvisaSalvati) daAnnunciare.push({ listing, next, previous: current });

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

  const avvisati = await avvisaChiHaSalvato(daAnnunciare);
  return { checked: (listings || []).length, updated, savedNotified: avvisati };
}

/**
 * Dice a chi ha messo la stellina che il prezzo è sceso.
 *
 * Finora i preferiti erano un segnalibro muto: la notifica di ribasso
 * esisteva ma andava al VENDITORE, cioè a chi il prezzo l'ha abbassato. Chi
 * aveva salvato l'annuncio perché lo trovava caro non lo sapeva mai.
 *
 * Il venditore è escluso: la sua notifica ce l'ha già, e riceverne due per
 * lo stesso evento è il modo più rapido per farle spegnere entrambe.
 *
 * Non lancia mai: il prezzo è già aggiornato e la notifica è un di più —
 * far fallire il cron per un avviso non mandato peggiorerebbe le cose,
 * perché al giro dopo si ripartirebbe da capo su tutti gli annunci.
 */
async function avvisaChiHaSalvato(daAnnunciare) {
  if (!daAnnunciare.length) return 0;

  try {
    const ids = daAnnunciare.map((x) => x.listing.id);
    const { data: righe, error } = await supabase
      .from("saved_listings")
      .select("user_id, listing_id")
      .in("listing_id", ids);
    if (error) throw error;

    const perAnnuncio = new Map();
    for (const r of righe || []) {
      if (!perAnnuncio.has(r.listing_id)) perAnnuncio.set(r.listing_id, []);
      perAnnuncio.get(r.listing_id).push(r.user_id);
    }

    const notifiche = [];
    const push = [];
    for (const { listing, next, previous } of daAnnunciare) {
      const destinatari = (perAnnuncio.get(listing.id) || []).filter((u) => u && u !== listing.user_id);
      if (!destinatari.length) continue;

      const titolo = "È sceso di prezzo";
      const corpo = `«${listing.title || ""}» ora a ${next.toFixed(2)}€`;
      for (const userId of destinatari) {
        notifiche.push({
          user_id: userId,
          type: "saved_listing_price_dropped",
          title: titolo,
          body: corpo,
          // listingId porta il tocco sulla notifica dritto all'annuncio:
          // NotificationsScreen ha già il ramo che apre ListingDetail.
          data: { listingId: listing.id, price: next, previousPrice: previous },
        });
      }
      push.push({ destinatari, titolo, corpo, listingId: listing.id });
    }

    if (!notifiche.length) return 0;

    const { error: insErr } = await supabase.from("notifications").insert(notifiche);
    if (insErr) throw insErr;

    for (const p of push) {
      sendExpoPush(p.destinatari, {
        title: p.titolo,
        body: p.corpo,
        data: { type: "saved_listing_price_dropped", listingId: p.listingId },
      });
    }
    return notifiche.length;
  } catch (e) {
    console.error("[priceDecay] avviso ai preferiti fallito:", e?.message || e);
    return 0;
  }
}
