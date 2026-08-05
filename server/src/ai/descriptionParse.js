// server/src/ai/descriptionParse.js
import { toFile } from "openai";
import { createOpenAIClient, isQuotaExhausted, userFacingAIError } from "../lib/openaiClient.js";
import { reportFault } from "../lib/monitoring.js";

const MODEL = process.env.MATCH_AI_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.MATCH_AI_TEMP ?? 0);

// Timeout più largo: il ramo PDF (parseListingFromPdfAI) manda un documento
// intero da leggere, non solo poche righe di testo.
const client = createOpenAIClient({ timeoutMs: Number(process.env.OPENAI_PARSE_TIMEOUT_MS || 45_000) });

// BUDGET DEL RAMO PDF, e perché è più stretto del resto.
//
// L'app aspetta 90 secondi (lib/descriptionParser.js) e poi molla. Se il
// server ci mette di più, l'utente non riceve un messaggio: riceve una
// rotellina che gira e basta — è successo, ed è il difetto peggiore fra
// quelli possibili, perché non lascia nemmeno un indizio.
//
// Il conto va fatto per intero, e dopo il passaggio alla Files API le
// chiamate a OpenAI sono DUE (carica il file, poi leggilo), non una:
//   45s di timeout x 2 tentativi del SDK x 2 chiamate x 2 giri miei = ~6 min.
// Sei minuti contro 90 secondi di pazienza. Qui il SDK non ritenta
// (maxRetries: 0, il ritentativo lo gestisce withOpenAIRetry, uno solo e
// consapevole del tempo rimasto) e ogni chiamata ha 30 secondi: caso
// peggiore 30+30 = 60s, che sta dentro il budget con margine.
const PDF_CALL_TIMEOUT_MS = Number(process.env.OPENAI_PDF_TIMEOUT_MS || 30_000);
const PDF_BUDGET_MS = Number(process.env.OPENAI_PDF_BUDGET_MS || 70_000);
const pdfClient = createOpenAIClient({ timeoutMs: PDF_CALL_TIMEOUT_MS, maxRetries: 0 });

// Oggi (per la regola: primo anno utile nel futuro)
function nowIsoMinutes() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MI = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MI}`;
}

const SYSTEM_PROMPT = `
Sei un parser di annunci di viaggio in italiano. Leggi la descrizione e restituisci SOLO un JSON valido che rispetta esattamente lo schema dato (tutte le chiavi sempre presenti; se un’informazione è assente o dubbia metti null).
Regole vincolanti:

1) Tipo
- "type": "train" per biglietti treno, "hotel" per soggiorni; altrimenti null.
- "cercoVendo": "CERCO" se l’utente cerca, "VENDO" se vende; se non chiaro null.

2) Tratta (sempre Origine-->Destinazione)
- Estrai "origin" e "destination" (includi dettagli di stazione se presenti, es. "Roma Tiburtina").
- "route": costruiscila sempre come "<origin-->destination>" usando ESATTAMENTE l'arrow ASCII "-->" (due trattini + ">"), senza spazi extra attorno ai trattini. Esempio: "Napoli-Afragola-->Roma Tiburtina".
- "location": per i treni deve essere uguale a "route". Per hotel, se non ha senso una tratta, usa la città/località; altrimenti null.

3) Titolo (standardizzato)
- Treni: il "title" deve essere SEMPRE "<Cerco/Vendo> treno <origin-->destination> solo andata".
- Hotel: "title" = "<Cerco/Vendo> hotel <location>".
- Non inserire MAI prezzo o date nel titolo. Se "cercoVendo" è null, NON inventare l'azione: usa "Treno <origin-->destination> solo andata" (o "Hotel <location>") senza prefisso.

4) Date e orari
- Hotel: "checkIn" e "checkOut" in "YYYY-MM-DD".
- Treno: "departAt" e "arriveAt" in "YYYY-MM-DD HH:mm" (24h).
- Se nel testo è indicato SOLO giorno e mese (nessun anno), determina l’anno come il PRIMO ANNO UTILE NEL FUTURO rispetto a "oggi".
- Se nel testo è indicato ANCHE l’anno, usalo ESATTAMENTE come scritto, anche se la data/ora risultante è nel passato rispetto a "oggi": un biglietto con data passata è semplicemente scaduto/non valido, NON tocca a te "correggerlo" spostandolo in avanti.
- "Oggi" ti viene passato nel messaggio utente con il formato "YYYY-MM-DD HH:mm".

5) Prezzo
- "price" numero o stringa numerica se presente, altrimenti null.
- NON inserire mai il prezzo nel "title".

6) Altri campi
- "isNamedTicket": true se esplicitamente nominativo/cedibile; false se esplicitamente non nominativo; altrimenti null.
- "gender": "M" o "F" se indicato; altrimenti null.
- "pnr": 5–8 alfanumerici se presente e realistico; altrimenti null.
- "imageUrl": URL se presente; altrimenti null.
- "ticketClass": la CLASSE di viaggio, cioè dove si è seduti: "1a"/"Prima", "2a"/"Seconda", "Business", "Executive", "Standard", "Prima Business", "Smart", "Comfort", "Prestige"… Riportala come è scritta sul documento.
- "fareType": la TARIFFA commerciale, cioè le condizioni di acquisto: "Base", "Economy", "Super Economy", "Flex", "Low Cost", "Young", "Senior"… Riportala come è scritta sul documento.
- ATTENZIONE, "ticketClass" e "fareType" sono cose DIVERSE e non vanno confuse: un biglietto può essere "Business" (classe) con tariffa "Economy". Se il documento riporta solo una delle due, l'altra resta null: non dedurre mai l'una dall'altra.
- Non inventare né l'una né l'altra: se non compaiono nel testo, null.

7) Formati e pulizia
- Mantieni accenti, maiuscole/minuscole naturali e trattini dei nomi luogo/stazione.
- Rimuovi ripetizioni, spazi doppi ed etichette non necessarie nella "route".
- Restituisci SOLO JSON (nessun testo extra). Nessuna chiave aggiuntiva rispetto allo schema.

8) Fornitore
- "provider": indicalo col nome comune del fornitore (es. "Booking.com", "Trenitalia", "Italo", "Ryanair", "EasyJet", "Airbnb", "Expedia", "Trainline") quando è ragionevolmente deducibile dal testo, in due casi:
  a) il testo è chiaramente una conferma di prenotazione o nomina il fornitore esplicitamente;
  b) PER I TRENI, il testo nomina un servizio/marchio commerciale esclusivo di un operatore, anche senza dire il nome dell'azienda: "Frecciarossa", "Frecciargento", "Freccia Bianca"/"Frecciabianca", "Intercity", "Intercity Notte", "EuroCity", "Euronight" → "Trenitalia"; "Italo" (il treno stesso si chiama così) → "Italo".
- "Regionale"/"Regionale Veloce" da soli NON bastano a dedurre l'operatore: sono gestiti da più aziende diverse a seconda della regione (Trenitalia, Trenord, TPER…) — lascia "provider" null a meno che il testo non nomini esplicitamente anche l'azienda.
- Se resta ambiguo o non chiaro, metti null: non inventare mai un fornitore.
`;

// Schema con chiavi estese (origin, destination, route, imageUrl)
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cercoVendo: { type: ["string", "null"], enum: ["CERCO", "VENDO", null] },
    type: { type: ["string", "null"], enum: ["hotel", "train", null] },

    title: { type: ["string", "null"] },

    origin: { type: ["string", "null"] },
    destination: { type: ["string", "null"] },
    route: { type: ["string", "null"] },
    location: { type: ["string", "null"] },

    checkIn: { type: ["string", "null"], description: "YYYY-MM-DD" },
    checkOut: { type: ["string", "null"], description: "YYYY-MM-DD" },

    departAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm" },
    arriveAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm" },
    returnAt: { type: ["string", "null"], description: "YYYY-MM-DD HH:mm (opzionale per treno)" },

    isNamedTicket: { type: ["boolean", "null"] },
    gender: { type: ["string", "null"], enum: ["M", "F", null] },
    pnr: { type: ["string", "null"] },
    price: { type: ["string", "null", "number"] },

    imageUrl: { type: ["string", "null"] },
    provider: { type: ["string", "null"], description: "Es. Booking.com, Trenitalia, Italo, Ryanair" },

    // Classe = dove si è seduti; tariffa = a quali condizioni si è comprato.
    // Due dati distinti, tenuti separati apposta (vedi la regola 6 del
    // prompt): dalla tariffa dipende se il biglietto è reintestabile.
    ticketClass: { type: ["string", "null"], description: "Es. Prima, Seconda, Business, Executive, Standard" },
    fareType: { type: ["string", "null"], description: "Es. Base, Economy, Super Economy, Flex, Low Cost" }
  },
  required: [
    "cercoVendo","type","title",
    "origin","destination","route","location",
    "checkIn","checkOut",
    "departAt","arriveAt","returnAt",
    "isNamedTicket","gender","pnr","price",
    "imageUrl","provider",
    "ticketClass","fareType"
  ]
};

const EMPTY = {
  cercoVendo: null,
  type: null,
  title: null,

  origin: null,
  destination: null,
  route: null,
  location: null,

  checkIn: null,
  checkOut: null,

  departAt: null,
  arriveAt: null,
  returnAt: null,

  isNamedTicket: null,
  gender: null,
  pnr: null,
  price: null,

  imageUrl: null,
  provider: null,

  ticketClass: null,
  fareType: null
};

// ---- Helpers di normalizzazione lato server (senza regex di parsing sul testo utente)

function normStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function ensureArrow(route) {
  // forza ASCII "-->" senza spazi attorno ai trattini
  const a = normStr(route);
  if (!a) return null;
  // rimpiazza eventuali frecce unicode o "->" con "-->"
  return a.replace(/\s*[-–—]*>\s*|→|↦|⇒|➔|⟶/g, "-->").replace(/\s*-->\s*/g, "-->");
}

function makeRoute(origin, destination) {
  const a = normStr(origin);
  const b = normStr(destination);
  if (!a && !b) return null;
  if (!b) return a;
  if (!a) return b;
  return `${a}-->${b}`;
}

function sanitizeParsed(obj) {
  // unisci con EMPTY per garantire tutte le chiavi
  const p = { ...EMPTY, ...(obj || {}) };

  // normalizza stringhe base
  p.cercoVendo = (p.cercoVendo === "CERCO" || p.cercoVendo === "VENDO") ? p.cercoVendo : null;
  p.type = (p.type === "hotel" || p.type === "train") ? p.type : null;

  const origin = normStr(p.origin);
  const destination = normStr(p.destination);

  // route/location coerenti: route sempre "origin-->destination" se possibile
  let route = ensureArrow(p.route) || makeRoute(origin, destination);
  route = ensureArrow(route);

  let location = normStr(p.location);
  if (p.type === "train") {
    location = route || location || null; // per treni location = route
  }
  // pulizia origin/destination
  p.origin = origin;
  p.destination = destination;
  p.route = route;
  p.location = location;

  // prezzo in stringa, MAI nel titolo
  if (typeof p.price === "number") p.price = String(p.price);

  p.provider = normStr(p.provider);

  // Classe e tariffa restano testo libero (le denominazioni commerciali
  // cambiano da operatore a operatore): qui si taglia solo la lunghezza,
  // perché sono etichette brevi e un valore chilometrico sarebbe comunque
  // un'estrazione andata storta.
  p.ticketClass = normStr(p.ticketClass)?.slice(0, 60) ?? null;
  p.fareType = normStr(p.fareType)?.slice(0, 60) ?? null;

  // NIENTE rollover forzato dell'anno qui: un biglietto con anno esplicito
  // già nel passato è scaduto/non valido, non va "corretto" spostandolo nel
  // futuro (bug storico: un biglietto "8 marzo 2026" letto da un documento
  // reale finiva pubblicato come "8 marzo 2027"). Il caso "solo giorno e
  // mese, nessun anno" resta gestito dal prompt (rollover al primo anno
  // futuro). La data nel passato viene bloccata più avanti, in creazione
  // annuncio (validazione "già passato").
  p.departAt = normStr(p.departAt);
  p.arriveAt = normStr(p.arriveAt);
  p.returnAt = normStr(p.returnAt);

  // Forza titolo secondo specifica. Se cercoVendo non è chiaro NON si
  // inventa "Vendo" (bug storico: un annuncio CERCO usciva col titolo
  // "Vendo treno..."): titolo neutro, l'azione la decide il client
  // in base alla scelta dell'utente.
  const actionWord = p.cercoVendo
    ? p.cercoVendo.charAt(0) + p.cercoVendo.slice(1).toLowerCase()
    : null;
  if (p.type === "train" && route) {
    p.title = actionWord ? `${actionWord} treno ${route} solo andata` : `Treno ${route} solo andata`;
  } else if (p.type === "hotel" && location) {
    p.title = actionWord ? `${actionWord} hotel ${location}` : `Hotel ${location}`;
  } else {
    // fallback minimale senza prezzo
    p.title = normStr(p.title) || actionWord;
  }

  // Per hotel: azzera campi treno
  if (p.type === "hotel") {
    p.departAt = null;
    p.arriveAt = null;
    p.returnAt = null;
  }
  // Per treno: azzera campi hotel
  if (p.type === "train") {
    p.checkIn = null;
    p.checkOut = null;
  }

  return p;
}

// Tetto di sicurezza sui caratteri in ingresso: una descrizione scritta a
// mano sta ben sotto, ma una conferma di prenotazione incollata per intero
// (email HTML->testo, con footer/legali) può arrivare a decine di migliaia
// di caratteri — tronca per tenere sotto controllo costo/latenza della
// chiamata, il contenuto utile (tratta/date/PNR/prezzo) è quasi sempre
// nelle prime righe.
const MAX_INPUT_CHARS = 8000;

export async function parseDescriptionWithAI(text, locale = "it") {
  if (!client) {
    const err = new Error("Servizio AI non configurato sul server (OPENAI_API_KEY mancante).");
    err.status = 503;
    throw err;
  }

  const user = String(text ?? "").trim().slice(0, MAX_INPUT_CHARS);
  if (!user) return { ...EMPTY };

  const today = nowIsoMinutes();

  const resp = await client.responses.create({
    model: MODEL,
    temperature: TEMPERATURE,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Oggi è: ${today}\n` +
          `Lingua: ${locale}\n` +
          `Testo annuncio:\n"""${user}"""\n` +
          `Rispondi SOLO con JSON conforme allo schema.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ParsedListing",
        strict: true,
        schema: JSON_SCHEMA
      },
    },
  });

  const out =
    resp?.output_text ||
    resp?.output?.[0]?.content?.[0]?.text ||
    resp?.choices?.[0]?.message?.content ||
    "";

  try {
    const raw = JSON.parse(out || "{}") || {};
    const clean = sanitizeParsed(raw);
    return clean;
  } catch {
    console.warn("[AI] JSON parse fallita. Raw:", out);
    const err = new Error("Il servizio AI ha risposto in un formato non valido.");
    err.status = 502;
    throw err;
  }
}

// ---- Import da PDF (biglietto/conferma) — assist anti-bagarinaggio ----
// Stesso schema/prompt del parser testuale: il PDF viene passato direttamente
// al modello come input_file (niente estrazione testo locale, nessuna
// dipendenza in più). L'esito è un ASSIST, non un giudizio di autenticità:
// un PDF si può falsificare, quindi il prezzo estratto precompila il campo
// "prezzo di acquisto" e segnala le discrepanze, ma il vincolo duro resta
// il CHECK a DB (price <= purchase_price).
// Tetto dimensione: un biglietto reale pesa pochi KB–2MB; oltre è sospetto
// e costoso. 6MB binari ≈ 8M caratteri base64.
const MAX_PDF_BASE64_CHARS = 8_000_000;

/**
 * Un secondo tentativo sui guasti temporanei di OpenAI.
 *
 * Il 520 osservato in produzione non ha corpo e non ha un codice
 * applicativo: è il bordo di rete che molla, e la volta dopo può andare
 * benissimo. Si ritenta UNA sola volta, e solo sui 5xx/429 — su un 400
 * (richiesta sbagliata) ritentare sarebbe solo tempo perso e un secondo
 * addebito.
 *
 * Il motivo vero finisce nei log con la dimensione del documento: davanti
 * a un errore senza corpo, sapere quanto pesava è metà della diagnosi.
 */
export async function withOpenAIRetry(fn, { what = "richiesta", budgetMs = 0 } = {}) {
  const started = Date.now();
  const transient = (e) => {
    // Credito esaurito: è un 429 come il limite di frequenza, ma non passa
    // aspettando. Ritentarlo raddoppia solo l'attesa prima di dire la
    // stessa cosa.
    if (isQuotaExhausted(e)) return false;
    const s = Number(e?.status);
    return !Number.isFinite(s) || s >= 500 || s === 429;
  };
  try {
    return await fn();
  } catch (e) {
    const elapsed = Date.now() - started;
    console.warn(`[AI] ${what}: primo tentativo fallito dopo ${elapsed}ms (${e?.status || "?"}) ${e?.message || e}`);
    if (!transient(e)) throw e;
    // Si ritenta SOLO se resta tempo per farlo davvero.
    //
    // Senza questo controllo il ritentativo raddoppia l'attesa proprio nel
    // caso peggiore: quello in cui il primo tentativo è morto per timeout,
    // cioè quando era già lento. E chi aspetta dall'altra parte molla a
    // 90 secondi — quindi il secondo giro non produrrebbe una risposta
    // migliore, produrrebbe una rotellina che gira e nessun messaggio.
    // Un guasto veloce (il 520 che ci interessa) ha invece tutto il tempo.
    if (budgetMs > 0 && elapsed * 2 + 1500 > budgetMs) {
      console.warn(`[AI] ${what}: niente secondo tentativo, budget ${budgetMs}ms quasi esaurito`);
      throw e;
    }
    await new Promise((r) => setTimeout(r, 1500));
    return fn();
  }
}

export async function parseTicketPdfWithAI(pdfBase64, locale = "it") {
  if (!client) {
    const err = new Error("Servizio AI non configurato sul server (OPENAI_API_KEY mancante).");
    err.status = 503;
    throw err;
  }

  const b64 = String(pdfBase64 ?? "").trim();
  if (!b64) return { ...EMPTY };
  if (b64.length > MAX_PDF_BASE64_CHARS) {
    const err = new Error("PDF troppo grande (max ~6MB)");
    err.status = 413;
    throw err;
  }

  const today = nowIsoMinutes();
  const bytes = Math.round((b64.length * 3) / 4);

  // Il PDF si CARICA, non si incolla dentro la richiesta.
  //
  // Prima viaggiava come data URI base64 dentro il JSON: un biglietto da
  // 3MB diventava una richiesta da oltre 4MB, e OpenAI rispondeva "520
  // status code (no body)" — un guasto del loro bordo di rete, senza
  // spiegazione, quindi senza niente da mostrare all'utente e niente da
  // cui capire cosa fosse successo (osservato in produzione, 4 agosto).
  // Con la Files API la richiesta resta di poche centinaia di byte e il
  // documento viaggia sul canale fatto apposta per i file.
  let uploaded = null;
  const resp = await withOpenAIRetry(async () => {
    if (!uploaded) {
      uploaded = await pdfClient.files.create({
        file: await toFile(Buffer.from(b64, "base64"), "ticket.pdf", { type: "application/pdf" }),
        purpose: "user_data",
      });
    }
    return pdfClient.responses.create({
      model: MODEL,
      temperature: TEMPERATURE,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Oggi è: ${today}\n` +
                `Lingua: ${locale}\n` +
                `Il documento allegato è un biglietto o una conferma di prenotazione. ` +
                `Estrai i campi dal documento. Il "price" è il prezzo effettivamente pagato indicato nel documento. ` +
                `Rispondi SOLO con JSON conforme allo schema.`,
            },
            { type: "input_file", file_id: uploaded.id },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ParsedListing",
          strict: true,
          schema: JSON_SCHEMA
        },
      },
    });
  }, { what: `PDF ${Math.round(bytes / 1024)}KB`, budgetMs: PDF_BUDGET_MS }).finally(() => {
    // Il documento non deve restare depositato da un fornitore terzo più
    // del necessario: serve solo per questa lettura. La cancellazione è
    // best-effort e non deve poter far fallire un import riuscito.
    if (uploaded?.id) {
      pdfClient.files.del(uploaded.id).catch((e) =>
        console.warn("[AI] PDF non cancellato da OpenAI:", uploaded.id, e?.message || e),
      );
    }
  });

  const out =
    resp?.output_text ||
    resp?.output?.[0]?.content?.[0]?.text ||
    "";

  try {
    return sanitizeParsed(JSON.parse(out || "{}") || {});
  } catch {
    console.warn("[AI] JSON parse PDF fallita. Raw:", out?.slice?.(0, 200));
    const err = new Error("Il servizio AI ha risposto in un formato non valido.");
    err.status = 502;
    throw err;
  }
}

// Route HTTP
//
// Gli errori NON vengono mascherati con "ok:true + EMPTY" (com'era prima "per
// resilienza UI"): una risposta vuota è indistinguibile da "l'AI non ha
// trovato nulla nel testo", quindi il client compilava zero campi senza poter
// dire perché — bug reale segnalato dall'utente ("Compila con AI" che portava
// alla schermata dei dettagli tutta vuota, in silenzio, mentre la vera causa
// era lato server). Un guasto di configurazione o del modello deve arrivare
// all'utente con un messaggio leggibile, non sparire in un 200.
export function mountParseDescriptionRoute(app, requireAuth) {
  app.post("/ai/parse-description", requireAuth, async (req, res) => {
    try {
      const { text, locale = "it" } = req.body || {};
      const data = await parseDescriptionWithAI(text, locale);
      return res.json({ ok: true, data });
    } catch (err) {
      reportFault("/ai/parse-description", err, { status: err?.status });
      const status = err?.status || 502;
      return res.status(status).json({
        ok: false,
        error: err?.message || "Analisi della descrizione non riuscita.",
      });
    }
  });

  app.post("/ai/parse-ticket-pdf", requireAuth, async (req, res) => {
    try {
      const { pdfBase64, locale = "it" } = req.body || {};
      const data = await parseTicketPdfWithAI(pdfBase64, locale);
      return res.json({ ok: true, data });
    } catch (err) {
      // Nei log il messaggio ORIGINALE, senza filtri: è quello che serve a
      // noi per capire. All'utente va invece una frase comprensibile —
      // "aggiungi credito su platform.openai.com" non gli dice niente, e
      // intanto gli racconta con che fornitore lavoriamo e che abbiamo il
      // conto scoperto.
      reportFault("/ai/parse-ticket-pdf", err, { status: err?.status });
      const status = isQuotaExhausted(err) ? 503 : (err?.status || 502);
      return res.status(status).json({
        ok: false,
        error: userFacingAIError(err) || "Lettura del PDF non riuscita.",
      });
    }
  });
}
