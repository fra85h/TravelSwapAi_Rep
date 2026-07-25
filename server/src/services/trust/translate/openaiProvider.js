import { createOpenAIClient } from "../../../lib/openaiClient.js";

// Se la chiave manca, il costruttore di OpenAI lancia un'eccezione a livello
// di modulo — a import time, non dentro una funzione — che far cadere
// l'intero server all'avvio (bug preesistente, stesso pattern trovato anche
// in aiTrust.js e fbParser.js). Costruito solo se la chiave è presente.
const client = createOpenAIClient();
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Segnaposto da NON tradurre: {NOME} e <<NOME>>. Vengono sostituiti con un
// token neutro prima di mandare il testo al modello e rimessi al loro posto
// dopo, così una traduzione non può alterarli o tradurli.
export const PH_RE = /(\{[A-Z0-9_]+\}|<<[A-Z0-9_]+>>)/gi;

export function protect(text="") {
  const m = new Map(); let i=0;
  const safe = text.replace(PH_RE, (all) => { const k = `__PH_${i++}__`; m.set(k, all); return k; });
  return { safe, m };
}

export function restore(text="", m) {
  let out = text;
  for (const [k,v] of m.entries()) out = out.replaceAll(k, v);
  return out;
}

export function normalize(s="") {
  return s.replace(/travelswapai/gi,"TravelSwapAI").replace(/trust\s*score/gi,"TrustScore");
}

export async function openaiTranslate({ text, targetLang, sourceLang="auto" }) {
  if (!text) return "";
  if (!client) return null; // chiave non configurata: fallimento distinto, vedi commento sopra
  const { safe, m } = protect(text);
  const sys = "You are a professional translator. Translate the ENTIRE text faithfully and completely — do not summarize, shorten, or omit any part of it. Preserve tokens like __PH_0__ EXACTLY. Output only the translated text, nothing else.";
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
    // normalize PRIMA di restore: applicata dopo, la sua sostituzione di
    // "trust score" -> "TrustScore" riscriverebbe anche l'INTERNO di un
    // segnaposto appena ripristinato (es. {TRUSTSCORE} diventerebbe
    // {TrustScore}, e l'app non lo riconoscerebbe più). Sui token __PH_n__
    // normalize non ha alcun effetto, quindi quest'ordine è sempre sicuro.
    return restore(normalize(out), m);
  } catch (e) {
    console.error("[openaiTranslate] error", e);
    return null; // fallimento distinto da "" (niente da tradurre): il chiamante non deve spacciarlo per un successo
  }
}
