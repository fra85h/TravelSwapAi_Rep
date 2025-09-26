import OpenAI from "openai";

/**
 * Traduzione con OpenAI Responses API.
 * - preserva placeholder {LIKE_THIS} e <<LIKE_THIS>>
 * - applica glossario semplice post-traduzione
 */
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const PLACEHOLDER_RE = /(\{[A-Z0-9_]+\}|<<[A-Z0-9_]+>>)/g;

function extractPlaceholders(text = "") {
  const map = new Map();
  let i = 0;
  const safe = text.replace(PLACEHOLDER_RE, (m) => {
    const key = `__PH_${i++}__`;
    map.set(key, m);
    return key;
  });
  return { safe, map };
}

function restorePlaceholders(text = "", map) {
  let out = text;
  for (const [k, v] of map.entries()) out = out.replaceAll(k, v);
  return out;
}

function applyGlossary(s = "") {
  return s
    .replace(/travelswapai/gi, "TravelSwapAI")
    .replace(/trust\s*score/gi, "TrustScore");
}

export async function openaiTranslate({ text, targetLang, sourceLang = "auto" }) {
  if (!text) return "";
  const { safe, map } = extractPlaceholders(text);

  const sys = [
    "You are a professional translator.",
    "Translate the user content into the target language.",
    "Preserve placeholders like __PH_0__ exactly.",
    "Do not add explanations, only return the translated text.",
  ].join(" ");

  const user = [
    `Target language: ${targetLang}`,
    sourceLang && sourceLang !== "auto" ? `Source language: ${sourceLang}` : "",
    "",
    safe,
  ].join("\n");

  const resp = await client.responses.create({
    model: MODEL,
    input: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ],
  });

  // Responses API → testo in resp.output_text
  const out = resp.output_text?.trim() || "";
  const restored = restorePlaceholders(out, map);
  return applyGlossary(restored);
}
