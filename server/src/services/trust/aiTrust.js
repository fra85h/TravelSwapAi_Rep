// server/src/services/trust/aiTrust.js
import { createOpenAIClient } from "../../lib/openaiClient.js";
import { reasonWithoutFalseClaims, fixesWithoutFalseClaims } from "./falseClaims.js";

// Bug preesistente corretto: il costruttore di OpenAI lancia un'eccezione
// a livello di modulo se la chiave manca — a import time, prima che il
// controllo esplicito qui sotto (riga ~15) abbia mai la possibilità di
// scattare — facendo cadere l'intero server all'avvio, non solo questa
// funzione. Costruito solo se la chiave è presente, stesso pattern già
// corretto in ai/score.js.
// Timeout più largo della media: questa chiamata può includere fino a 3
// immagini da analizzare (vedi imageUrls sotto), quindi è la più lenta.
const openai = createOpenAIClient({ timeoutMs: Number(process.env.OPENAI_TRUST_TIMEOUT_MS || 45_000) });

// Il modello a volte "spiega" il punteggio con una frase vuota di contenuto.
// Sono risposte che occupano lo spazio della spiegazione senza dire nulla:
// meglio nessun testo (il client ripiega sul messaggio generico) che una
// frase che finge di rispondere alla domanda "perché non è 100?".
const VACUOUS_REASON_RE = /^(va bene|tutto (ok|bene|a posto)|nessun problema|ok|buono|corretto|coerente|conforme|adeguato|sufficiente|niente da segnalare|nulla da segnalare|no issues?|all good|fine|todo bien|sin problemas)\b/i;

export function cleanTextReason(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (VACUOUS_REASON_RE.test(s)) return null;
  // Una spiegazione lunga non entra nel riquadro e smette di essere leggibile
  // a colpo d'occhio, che è tutto il suo scopo.
  return s.length > 240 ? `${s.slice(0, 237)}…` : s;
}

/**
 * Valuta un listing con AI e restituisce:
 * - textScore: 0..100
 * - textReason: string|null — perché il punteggio del testo non è massimo
 * - imageScore: 0..100 (50 default se nessuna immagine)
 * - flags: [{ code, msg }]
 * - suggestedFixes: [{ field, suggestion }]
 */
export async function aiTrustReview(listing, heur = {}, locale = 'it') {
  const lang = ['it', 'en', 'es'].includes(locale) ? locale : 'it';
  const LANG_NAME = { it: 'italiano', en: 'inglese', es: 'spagnolo' }[lang];
  // Fallback immediato se manca la chiave
  if (!process.env.OPENAI_API_KEY) {
    return {
      textScore: Number.isFinite(heur?.score) ? Number(heur.score) : 55,
      textReason: null,
      imageScore: 50,
      flags: [{ code: "AI_DISABLED", msg: "Chiave OpenAI mancante sul server (OPENAI_API_KEY non impostata)" }],
      suggestedFixes: [],
    };
  }

  // Prepara contenuti (testo + immagini opzionali)
  const userContent = [];

  userContent.push({
    type: "text",
    text:
      "Sei un sistema di risk analysis per annunci (treni/hotel). " +
      "Oltre a prezzo, coerenza dei dati e pattern tipici da truffa, valuta " +
      "ANCHE se la tratta è geograficamente/logisticamente plausibile per il " +
      "mezzo indicato in `type`. IMPORTANTE per i treni: la rete ferroviaria " +
      "italiana collega praticamente TUTTE le città della penisola e le " +
      "principali città della Sicilia. Le tratte lunghe ma reali sono " +
      "PLAUSIBILI e NON vanno segnalate: es. Ancona→Bari, Milano→Lecce, " +
      "Torino→Reggio Calabria, Venezia→Napoli, Genova→Roma sono tutte tratte " +
      "ferroviarie valide. Anche le tratte INTERNE alla Sicilia sono valide e " +
      "NON vanno segnalate: es. Palermo→Messina, Palermo→Catania, " +
      "Messina→Catania, Catania→Siracusa. Segnala IMPLAUSIBLE_ROUTE SOLO quando la tratta è " +
      "REALMENTE impossibile in treno e ne sei ragionevolmente certo: isole " +
      "minori senza ferrovia (es. Lampedusa, Pantelleria, Capri), collegamenti " +
      "Sardegna↔continente su rotaia, oppure località palesemente inesistenti o " +
      "assurde. NEL DUBBIO considera la tratta plausibile e NON segnalarla. " +
      "Per un annuncio hotel, verifica solo che la città/location sia un luogo reale. " +
      "Quando la tratta è impossibile secondo questi criteri, aggiungi un flag " +
      "con code:'IMPLAUSIBLE_ROUTE' e un msg che spiega perché. " +
      // Niente esempi di città qui (stessa lezione degli esempi su numero
      // treno/classe: il modello li copiava). E soglia ALTA di proposito: il
      // modello non ha orari reali, e su tratte regionali brevi tirava a
      // indovinare — caso reale: 1h30 Piacenza→Brescia dichiarata "troppo
      // lunga" quando è una durata normale via Cremona. Il backstop
      // deterministico (computeTrustScore) scarta comunque i giudizi fini.
      "Valuta anche la DURATA del viaggio (depart_at→arrive_at), ma segnala " +
      "IMPLAUSIBLE_DURATION SOLO quando la durata è ASSURDA in modo evidente " +
      "e incontestabile — ordini di grandezza sbagliati, non scostamenti. " +
      "NON conosci gli orari reali dei treni: NON stimare mai quanto " +
      "'dovrebbe' durare una specifica tratta, e NON segnalare differenze di " +
      "decine di minuti o di un'ora. NEL DUBBIO non segnalare. Quando segnali, " +
      "aggiungi un msg che spiega perché. " +
      "Se sono presenti immagini, valuta se sono COERENTI con un annuncio di " +
      "viaggio di questo tipo (biglietto, stazione, hotel, camera, luogo): " +
      "foto del tutto estranee (cibo, selfie, oggetti non pertinenti) meritano " +
      "un flag con code:'IRRELEVANT_IMAGES' e un msg che dice cosa mostrano. " +
      "Valuta inoltre la COERENZA tra titolo/descrizione e i dati strutturati " +
      "(type, origin/destination, date, price, e l'azione cerco/vendo se " +
      "presente). Segnala INCOHERENT_LISTING SOLO in presenza di una " +
      "contraddizione EVIDENTE e concreta — es. la descrizione parla di hotel " +
      "ma type è train, cita una città/tratta chiaramente diversa da " +
      "origin/destination, riporta un prezzo esplicito molto diverso da price, " +
      "oppure dice esplicitamente di VENDERE mentre l'annuncio è in CERCA (o " +
      "viceversa). Una descrizione breve, generica o parziale che semplicemente " +
      "NON contraddice i campi è COERENTE e NON va segnalata (es. 'Cerco Roma " +
      "Termini-Firenze' su un annuncio Cerco treno Roma→Firenze è coerente). " +
      "NEL DUBBIO considera l'annuncio coerente e NON segnalarlo. Quando c'è una " +
      "contraddizione evidente, aggiungi un flag con code:'INCOHERENT_LISTING' " +
      "e un msg che spiega la discrepanza in modo concreto. " +
      "QUESTO È UN MARKETPLACE DI RIVENDITA: ogni annuncio valido riguarda per " +
      "definizione un viaggio/soggiorno FUTURO (è il motivo per cui viene " +
      "rivenduto). Una data di partenza o di check-in nel futuro è quindi " +
      "NORMALE E ATTESA, mai un segnale sospetto: non scrivere MAI in " +
      "'textReason' o in un 'msg' che la data è 'nel futuro', che 'non è " +
      "chiaro se il viaggio esista davvero' o simili — è un ragionamento "  +
      "capovolto per questo tipo di annuncio, non un problema reale. " +
      "SEMPRE, anche quando non c'è nessun flag da segnalare, spiega in " +
      "'textReason' PERCHÉ hai assegnato quel 'textScore': una sola frase " +
      "breve e CONCRETA, riferita a QUESTO annuncio, che dica cosa lo rende " +
      "meno solido. Se il punteggio non è massimo un motivo esiste sempre: " +
      "NON rispondere con frasi generiche tipo 'va bene' o 'nessun " +
      "problema'. Se e solo se 'textScore' è 100, lascia 'textReason' come " +
      "stringa vuota. Non citare mai il punteggio numerico dentro " +
      "'textReason'. " +
      // Nessun esempio di frase, e nessun elenco di dati "tipicamente
      // mancanti": erano lì per spiegare la regola, ma il modello li copiava
      // alla lettera. Un annuncio la cui descrizione diceva "546 seconda
      // classe" si è visto rispondere che mancavano il numero del treno e la
      // classe — cioè le due voci nominate qui come esempio. Le istruzioni
      // restano astratte di proposito; la verifica vera è deterministica,
      // lato server (services/trust/falseClaims.js).
      "REGOLA VINCOLANTE su 'textReason' e su ogni 'msg': prima di scrivere " +
      "che un dato MANCA o non è indicato, RILEGGI l'oggetto Listing qui " +
      "sotto e cerca quel dato in TUTTI i campi — 'title', 'description' e i " +
      "campi strutturati (type, origin, destination, location, startDate, " +
      "endDate, price) — anche se compare in una forma diversa da quella che " +
      "ti aspetti. Un dato presente anche in UNO SOLO di questi campi NON è " +
      "mancante. Segnala solo ciò che hai VERIFICATO essere assente: se non " +
      "sei certo che manchi, preferisci commentare la QUALITÀ di ciò che è " +
      "scritto (chiarezza, ordine, informazioni utili all'acquirente) invece " +
      "di dichiarare una lacuna. Mai inventare una lacuna. " +
      "Restituisci SOLO un JSON con la forma: " +
      "{ textScore:number(0-100), textReason:string, imageScore:number(0-100), flags:[{code:string,msg:string}], suggestedFixes:[{field:string,suggestion:string}] } " +
      `I valori di 'msg', 'suggestion' e 'textReason' devono essere scritti in ${LANG_NAME} (i 'code' restano invariati, in inglese maiuscolo). ` +
      "Usa rigore: nessun testo extra oltre al JSON.",
  });

  userContent.push({
    type: "text",
    text: `Contesto_heuristics: ${JSON.stringify({
      heurScore: heur?.score ?? null,
      consistency: heur?.consistencyScore ?? null,
      plausibility: heur?.plausibilityScore ?? null,
      completeness: heur?.completenessScore ?? null,
      flags: heur?.flags ?? [],
    })}`,
  });

  // IMPORTANTE: NON serializzare le foto dentro al testo. Una foto in
  // base64 (~1MB) diventa ~300k token di testo grezzo: con 3-4 foto la
  // richiesta superava 1,2M token e OpenAI la rifiutava con 429 "Request
  // too large" (limite 200k), facendo fallire l'intero Check AI. Le
  // immagini vanno SOLO come `image_url` qui sotto, dove vengono
  // tokenizzate come immagini (poche decine di token), non come testo.
  const { images: _omitImages, ...listingNoImages } = listing || {};
  userContent.push({
    type: "text",
    text: `Listing: ${JSON.stringify(listingNoImages)}`,
  });

  // Accetta sia URL https (foto già caricate) sia data URI base64 (foto
  // ancora locali al momento del Check AI in creazione — prima di questa
  // modifica le foto non venivano MAI viste dall'AI, perché l'upload
  // avviene solo alla pubblicazione).
  const imageUrls = Array.isArray(listing?.images)
    ? listing.images
        .map((i) => (i?.url || i?.uri || "").trim())
        .filter((u) => /^https?:\/\//i.test(u) || /^data:image\//i.test(u))
    : [];

  // detail:"low" → costo fisso ~85 token/immagine: per il controllo di
  // COERENZA (biglietto/stazione vs cibo/selfie) la bassa risoluzione
  // basta, e tiene la richiesta piccola e prevedibile.
  for (const url of imageUrls.slice(0, 3)) {
    userContent.push({
      type: "image_url",
      image_url: { url, detail: "low" },
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_TRUST_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" }, // forza JSON
      // temperature 0: massima consistenza tra check ripetuti sullo stesso
      // annuncio (un punteggio di rischio non deve ballare a ogni click).
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Sei un analista antifrode. Rispondi sempre e solo con JSON valido secondo il formato richiesto.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // se (per qualche motivo) non è JSON puro, fallback
      parsed = {};
    }

    // Coercizioni + default sicuri
    const clamp01 = (n) => Math.min(100, Math.max(0, Number(n ?? 0)));
    const out = {
      textScore: clamp01(parsed.textScore ?? heur?.score ?? 55),
      // La spiegazione e i suggerimenti passano da un controllo che NON si
      // fida del modello: un'affermazione "manca X" viene confrontata con
      // l'annuncio, e se X c'è la frase viene scartata. Una spiegazione falsa
      // è peggio di nessuna spiegazione — manda a correggere qualcosa che è
      // già a posto.
      textReason: reasonWithoutFalseClaims(cleanTextReason(parsed.textReason), listing),
      imageScore: clamp01(parsed.imageScore ?? (imageUrls.length ? 60 : 50)),
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      suggestedFixes: fixesWithoutFalseClaims(parsed.suggestedFixes, listing),
    };

    return out;
  } catch (e) {
    // Il dettaglio del provider resta NEI LOG, non nella risposta: il testo di
    // un 429 di OpenAI contiene l'id dell'organizzazione e i limiti di quota
    // dell'account ("...in organization org-XXXX on tokens per min (TPM):
    // Limit 200000, Used 199145..."). Il messaggio del flag finisce dritto
    // nella lista "Possibili problemi" mostrata a CHIUNQUE stia pubblicando,
    // quindi quei dati arrivavano agli utenti finali. Il ragionamento di prima
    // ("l'SDK non mette mai la chiave nel messaggio") era giusto sulla chiave
    // ma non copriva il resto.
    console.error("[aiTrustReview] error:", e?.status || "", e?.message || e);

    // Allo status HTTP si può restare: non identifica nulla e serve a chi
    // legge i log a capire subito di che famiglia di problema si tratta
    // (401 chiave errata, 429 quota/limite, 404/403 modello non abilitato).
    const status = e?.status ? ` (${e.status})` : "";
    // Fallback: NON far mai fallire l’endpoint
    return {
      textScore: Number.isFinite(heur?.score) ? Number(heur.score) : 55,
      // Nessuna spiegazione inventata quando l'AI non ha risposto: il
      // punteggio qui viene dalle euristiche, non da un'analisi del testo.
      textReason: null,
      imageScore: imageUrls.length ? 60 : 50,
      flags: [{ code: "AI_ERROR", msg: `Verifica AI non riuscita${status}. Riprova fra qualche minuto.` }],
      suggestedFixes: [],
    };
  }
}
