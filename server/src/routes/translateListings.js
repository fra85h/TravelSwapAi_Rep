import express from "express";
import { supabase } from "../db.js";
import { openaiTranslate } from "../services/trust/translate/openaiProvider.js";

export const translateListingsRouter = express.Router();
  
/**
 * GET /api/listings/:id/translate?lang=en
 * d Ritorna { title, description, lang, originalLang, translated, cached }
 */   
translateListingsRouter.get("/api/listings/:id/translate", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const lang = String(req.query.lang || "").toLowerCase();
    if (!id || !lang) return res.status(400).json({ error: "missing_params" });

    // 1) ottieni annuncio (titolo/descrizione + lingua originale se presente)
    const { data: listing, error: e1 } = await supabase
      .from("listings")
      .select("id, title, description, lang") // se non hai "lang" puoi toglierlo
      .eq("id", id)
      .maybeSingle();
    if (e1) throw e1;
    if (!listing) return res.status(404).json({ error: "not_found" });

    const title = listing.title || "";
    const description = listing.description || "";
    const originalLang = (listing.lang || "").toLowerCase();

    // no-op: se già nella lingua richiesta
    if (originalLang && originalLang === lang) {
      return res.json({
        title,
        description,
        lang,
        originalLang,
        translated: false,
      });
    }

    // 2) cache
    const { data: cached } = await supabase
      .from("listing_translations")
      .select("title_translated, description_translated")
      .eq("listing_id", id)
      .eq("lang", lang)
      .maybeSingle();

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

    // 3) traduci con OpenAI
    const [tTitle, tDesc] = await Promise.all([
      openaiTranslate({ text: title,  targetLang: lang, sourceLang: originalLang || "auto" }),
      openaiTranslate({ text: description, targetLang: lang, sourceLang: originalLang || "auto" }),
    ]);

    // 4) salva cache
    await supabase.from("listing_translations").upsert({
      listing_id: id,
      lang,
      title_translated: tTitle,
      description_translated: tDesc,
      provider: "openai",
    });

    res.json({
      title: tTitle || title,
      description: tDesc || description,
      lang,
      originalLang,
      translated: true,
      cached: false,
    });
  } catch (e) {
    console.error("[GET /api/listings/:id/translate] error", e);
    res.status(500).json({ error: "translate_failed" });
  }
});
