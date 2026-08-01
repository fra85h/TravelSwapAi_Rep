// server/src/routes/priceCheck.js
import express from "express";
import { supabase } from "../db.js";
import { checkPriceWithAI, suggestPriceWithAI } from "../ai/priceCheck.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { extractPriceFactsFromAnswers, PRICE_RELEVANT_QUESTION_CODES } from "../models/listingQuestions.js";
import { rateLimitPriceCheck } from "../middleware/rateLimit.js";

export const priceCheckRouter = express.Router();

/**
 * Fatti utili al prezzo (operatore, classe) dichiarati dal venditore
 * rispondendo alle domande pubbliche sull'annuncio.
 * Best-effort: se la lettura fallisce si stima come prima, senza quei dati —
 * un'analisi meno precisa è comunque meglio di un errore.
 */
async function getAnsweredPriceFacts(listingId) {
  try {
    const { data, error } = await supabase
      .from("listing_questions")
      .select("code, answer, answered_at")
      .eq("listing_id", listingId)
      .in("code", PRICE_RELEVANT_QUESTION_CODES)
      .not("answered_at", "is", null);
    if (error) throw error;
    return extractPriceFactsFromAnswers(data || []);
  } catch (e) {
    console.error("[price-check] lettura risposte fallita:", e?.message || e);
    return {};
  }
}

// POST /api/listings/price-suggest — bozza in creazione, PRIMA di pubblicare:
// l'annuncio non esiste ancora come riga (nessun id), quindi a differenza di
// /price-check qui sotto i dati arrivano nel body, non da una select per id.
// Stesso limite di frequenza di /price-check: stesso budget OpenAI, stessa
// categoria di funzionalità ("analisi prezzo").
priceCheckRouter.post("/api/listings/price-suggest", requireAuth, rateLimitPriceCheck, async (req, res) => {
  try {
    const b = req.body || {};
    const type = b.type === "hotel" ? "hotel" : "train";
    const locale = ["it", "en", "es"].includes(b.locale) ? b.locale : "it";
    const draft = {
      type,
      currency: b.currency || "EUR",
      location: b.location || null,
      route_from: b.routeFrom || null,
      route_to: b.routeTo || null,
      depart_at: b.departAt || null,
      arrive_at: b.arriveAt || null,
      check_in: b.checkIn || null,
      check_out: b.checkOut || null,
      title: b.title || null,
      description: b.description || null,
      purchase_price: b.purchasePrice ?? null,
      // In creazione non esistono ancora domande/risposte (l'annuncio non è
      // pubblicato), ma l'operatore sì: il form lo ha già, ricavato da
      // "Compila con AI" o dall'import del biglietto. Se c'è si usa, se manca
      // si stima senza — come chiesto, l'AI tiene conto solo di ciò che sa.
      operator: b.operator || null,
      ticket_class: b.ticketClass || null,
    };
    const result = await suggestPriceWithAI(draft, locale);
    return res.json(result);
  } catch (e) {
    console.error("[price-suggest][server] error", e);
    return res.status(500).json({ available: false, reason: "server_error" });
  }
});

// GET /api/listings/:id/price-check
priceCheckRouter.get("/api/listings/:id/price-check", requireAuth, rateLimitPriceCheck, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ available: false, reason: "missing_id" });
    const locale = ["it", "en", "es"].includes(req.query.locale) ? req.query.locale : "it";

    const { data: listing, error } = await supabase
      .from("listings")
      .select("id, user_id, status, type, price, currency, location, route_from, route_to, check_in, check_out, depart_at, arrive_at, title, description, purchase_price, operator, ticket_class")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!listing) return res.status(404).json({ available: false, reason: "not_found" });

    // Il server usa la SERVICE_ROLE, che scavalca le RLS: senza questo
    // controllo qualunque utente autenticato poteva far analizzare un
    // annuncio ALTRUI non pubblico (in pausa, eliminato) e dedurne prezzo e
    // contenuto dalla spiegazione. Visibile solo ciò che è pubblico o proprio.
    const isOwner = String(listing.user_id) === String(req.user?.id);
    if (listing.status !== "active" && !isOwner) {
      return res.status(404).json({ available: false, reason: "not_found" });
    }

    // Operatore e classe pesano parecchio sul prezzo di mercato, ma spesso non
    // stanno nelle colonne: la classe non viene MAI chiesta dal form, e
    // l'operatore c'è solo quando l'AI è riuscita a dedurlo. Quando mancano,
    // il compratore può chiederli e la risposta del venditore è pubblica —
    // quella risposta è a tutti gli effetti un dato dichiarato dell'annuncio,
    // e ignorarla significava stimare al buio pur avendo l'informazione.
    // Colonna e risposta non possono contraddirsi: la domanda compare solo
    // quando la colonna è vuota (showWhen nel catalogo condiviso).
    const facts = await getAnsweredPriceFacts(listing.id);
    const enriched = {
      ...listing,
      operator: listing.operator || facts.operator || null,
      ticket_class: listing.ticket_class || facts.ticketClass || null,
    };

    const result = await checkPriceWithAI(enriched, locale);
    return res.json(result);
  } catch (e) {
    console.error("[price-check][server] error", e);
    return res.status(500).json({ available: false, reason: "server_error" });
  }
});
