import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const PH_RE = /(\{[A-Z0-9_]+\}|<<[A-Z0-9_]+>>)/gi;
function protect(text="") {
  const m = new Map(); let i=0;
  const safe = text.replace(PH_RE, (all) => { const k = `__PH_${i++}__`; m.set(k, all); return k; });
  return { safe, m };
}
function restore(text="", m) {
  let out = text;
  for (const [k,v] of m.entries()) out = out.replaceAll(k, v);
  return out;
}
function normalize(s="") {
  return s.replace(/travelswapai/gi,"TravelSwapAI").replace(/trust\s*score/gi,"TrustScore");
}

export async function openaiTranslate({ text, targetLang, sourceLang="auto" }) {
  if (!text) return "";
  const { safe, m } = protect(text);
  const sys = "You are a concise professional translator. Preserve tokens like __PH_0__ EXACTLY. Output only the translated text.";
  const user = `Target language: ${targetLang}\nSource language: ${sourceLang}\n\n${safe}`;
  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.1,
    });
    const out = resp.choices?.[0]?.message?.content?.trim() || "";
    return normalize(restore(out, m));
  } catch (e) {
    console.error("[openaiTranslate] error", e);
    return text;
  }
}
