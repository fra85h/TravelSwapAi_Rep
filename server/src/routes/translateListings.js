// server/src/routes/translateListings.js
import express from "express";
import { supabase } from "../db.js";
import { openaiTranslate } from "../services/trust/translate/openaiProvider.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { rateLimitTranslate } from "../middleware/rateLimit.js";

export const translateListingsRouter = express.Router();

// GET /api/listings/:id/translate?lang=xx
translateListingsRouter.get("/api/listings/:id/translate", requireAuth, rateLimitTranslate, async (req, res) => {
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

    // Riusa dalla cache solo i campi tradotti con successo in passato. Un
    // valore null in cache significa "il tentativo precedente è fallito",
    // non "niente da tradurre" (quel caso salva "") — altrimenti un
    // fallimento temporaneo di OpenAI resterebbe incollato per sempre a
    // ogni visita successiva, riproponendo sempre lo stesso risultato
    // parziale invece di ritentare.
    const needTitle = !cached || cached.title_translated == null;
    const needDesc = !cached || cached.description_translated == null;

    let tTitle = cached?.title_translated ?? null;
    let tDesc = cached?.description_translated ?? null;

    if (needTitle || needDesc) {
      const [freshTitle, freshDesc] = await Promise.all([
        needTitle ? openaiTranslate({ text: title, targetLang: lang, sourceLang: "auto" }) : Promise.resolve(tTitle),
        needDesc ? openaiTranslate({ text: description, targetLang: lang, sourceLang: "auto" }) : Promise.resolve(tDesc),
      ]);
      if (needTitle) tTitle = freshTitle;
      if (needDesc) tDesc = freshDesc;
    }

    // null = la chiamata OpenAI è fallita per quel campo, non "niente da tradurre"
    // (quel caso ritorna ""). Se falliscono entrambi, non fingere un successo:
    // il client mostrerebbe un pulsante "vedi originale" che alterna fra due
    // testi identici, sembrando rotto.
    const titleOk = tTitle !== null;
    const descOk = tDesc !== null;
    if (!titleOk && !descOk) {
      return res.json({
        title, description, lang, originalLang,
        translated: false, titleTranslated: false, descriptionTranslated: false, cached: !!cached,
      });
    }

    // Salvataggio in cache (se la tabella esiste) — solo se è stato tradotto
    // qualcosa di nuovo in questa richiesta.
    if (needTitle || needDesc) {
      try {
        await supabase.from("listing_translations").upsert({
          listing_id: id,
          lang,
          title_translated: titleOk ? tTitle : null,
          description_translated: descOk ? tDesc : null,
          provider: "openai",
        });
      } catch (e) {
        console.log("[translate][server] cache upsert skip:", e?.message || String(e));
      }
    }

    return res.json({
      title: titleOk ? tTitle : title,
      description: descOk ? tDesc : description,
      lang,
      originalLang,
      translated: true,
      // Flag per-campo: il client deve poter distinguere "tutto tradotto"
      // da "solo un campo tradotto", invece di mostrare un generico
      // "Tradotto automaticamente" che lascerebbe intendere (falsamente)
      // che anche il campo rimasto in originale sia stato elaborato.
      titleTranslated: titleOk,
      descriptionTranslated: descOk,
      cached: !needTitle && !needDesc,
    });
  } catch (e) {
    console.error("[translate][server] error", e);
    return res
      .status(500)
      .json({ error: "translate_failed", message: e?.message || String(e) });
  }
});
