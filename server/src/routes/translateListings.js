// server/src/routes/translateListings.js
import express from "express";
import { supabase } from "../db.js";
import { openaiTranslate } from "../services/trust/translate/openaiProvider.js";

export const translateListingsRouter = express.Router();

// GET /api/listings/:id/translate?lang=xx
translateListingsRouter.get("/api/listings/:id/translate", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const lang = String(req.query.lang || "").toLowerCase().split("-")[0];
    if (!id || !lang) return res.status(400).json({ error: "missing_params" });
    console.log("[translate][server] HIT", id, "lang=", lang);

    // 🔧 RIMOSSO "lang" dal SELECT perché la colonna non esiste nella tua tabella
    const { data: listing, error: e1 } = await supabase
      .from("listings")
      .select("id, title, description") // ← solo campi esistenti
      .eq("id", id)
      .maybeSingle();
    if (e1) throw e1;
    if (!listing) return res.status(404).json({ error: "not_found" });

    const title = listing.title || "";
    const description = listing.description || "";

    // Auto-detect della lingua di origine
    const originalLang = null; // non disponibile in tabella

    // Cache best-effort (se la tabella esiste)
    let cached = null;
    try {
      const { data } = await supabase
        .from("listing_translations")
        .select("title_translated, description_translated")
        .eq("listing_id", id)
        .eq("lang", lang)
        .maybeSingle();
      cached = data || null;
    } catch (e) {
      console.log("[translate][server] cache skip:", e?.message || String(e));
    }

    if (cached?.title_translated || cached?.description_translated) {
      return res.json({
        title: cached.title_translated || title,
        description: cached.description_translated || description,
        lang,
        originalLang,
        translated: true,
        cached: true,
      });
    }

    // Traduzione (sourceLang: "auto")
    const [tTitle, tDesc] = await Promise.all([
      openaiTranslate({ text: title, targetLang: lang, sourceLang: "auto" }),
      openaiTranslate({ text: description, targetLang: lang, sourceLang: "auto" }),
    ]);

    // Salvataggio in cache (se la tabella esiste)
    try {
      await supabase.from("listing_translations").upsert({
        listing_id: id,
        lang,
        title_translated: tTitle,
        description_translated: tDesc,
        provider: "openai",
      });
    } catch (e) {
      console.log("[translate][server] cache upsert skip:", e?.message || String(e));
    }

    return res.json({
      title: tTitle || title,
      description: tDesc || description,
      lang,
      originalLang,
      translated: true,
      cached: false,
    });
  } catch (e) {
    console.error("[translate][server] error", e);
    return res
      .status(500)
      .json({ error: "translate_failed", message: e?.message || String(e) });
  }
});
