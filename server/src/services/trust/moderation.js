// server/src/services/trust/moderation.js
// Moderazione contenuti (testo + immagini) dell'annuncio tramite l'endpoint
// OpenAI Moderations (omni-moderation-latest, gratuito). Rileva contenuti
// inappropriati/illeciti che il TrustScore generale non è progettato per
// cogliere. Fail-safe: se la chiave manca o l'API fallisce, non blocca nulla.
import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Mappa le categorie tecniche dell'API in messaggi leggibili in italiano.
const CATEGORY_LABELS = {
  sexual: "contenuto sessuale",
  "sexual/minors": "contenuto sessuale che coinvolge minori",
  harassment: "molestie",
  "harassment/threatening": "molestie con minacce",
  hate: "incitamento all'odio",
  "hate/threatening": "incitamento all'odio con minacce",
  violence: "violenza",
  "violence/graphic": "violenza esplicita",
  "self-harm": "autolesionismo",
  illicit: "attività illecite",
  "illicit/violent": "attività illecite violente",
};

/**
 * Ritorna { flagged: boolean, flags: [{code, msg}] }.
 * Non lancia mai: in caso di problemi ritorna { flagged:false, flags:[] }.
 */
export async function moderateListing(listing) {
  if (!client) return { flagged: false, flags: [] };

  const text = [listing?.title, listing?.description].filter(Boolean).join("\n").trim();
  // Accetta sia URL https sia data URI base64 (foto locali al Check AI)
  const imageUrls = Array.isArray(listing?.images)
    ? listing.images
        .map((i) => (i?.url || i?.uri || "").trim())
        .filter((u) => /^https?:\/\//i.test(u) || /^data:image\//i.test(u))
        .slice(0, 4)
    : [];

  const input = [];
  if (text) input.push({ type: "text", text });
  for (const url of imageUrls) input.push({ type: "image_url", image_url: { url } });
  if (input.length === 0) return { flagged: false, flags: [] };

  try {
    const resp = await client.moderations.create({
      model: "omni-moderation-latest",
      input,
    });

    const flags = [];
    let flagged = false;
    for (const result of resp?.results ?? []) {
      if (!result?.flagged) continue;
      flagged = true;
      const cats = Object.entries(result.categories || {})
        .filter(([, v]) => v === true)
        .map(([k]) => CATEGORY_LABELS[k] || k);
      const unique = [...new Set(cats)];
      flags.push({
        code: "CONTENT_FLAGGED",
        msg: `Contenuto potenzialmente inappropriato${unique.length ? `: ${unique.join(", ")}` : ""}`,
      });
    }
    return { flagged, flags };
  } catch (e) {
    console.error("[moderateListing] error:", e?.message || e);
    return { flagged: false, flags: [] };
  }
}
