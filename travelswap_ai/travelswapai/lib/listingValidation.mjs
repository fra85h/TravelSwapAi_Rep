// Le regole che dicono se un annuncio si può pubblicare.
//
// Stavano dentro CreateListingScreen, chiuse in una useCallback: l'unico modo
// di provarle era montare una schermata da 4.200 righe con dentro Supabase,
// la fotocamera e il selettore di immagini. Non le ha mai provate nessuno, e
// due buchi sono rimasti lì finché non li ha trovati il database:
//
//   - prezzo 0: qui passava (si bloccava solo il negativo), ma a DB c'è
//     chk_listings_price_positive CHECK (price > 0). L'annuncio veniva
//     rifiutato DOPO la verifica AI, con un "Impossibile pubblicare" che non
//     diceva quale campo fosse il problema.
//   - prezzo enorme: listings.price è numeric(10,2), quindi sopra
//     99.999.999,99 Postgres risponde "numeric field overflow" — di nuovo un
//     errore grezzo al posto di un messaggio.
//
// Qui dentro non si entra in rete e non si tocca React: si passa il form e si
// riceve la mappa campo → messaggio.
import { parseLocalizedNumber } from "./number.js";

const pad2 = (n) => String(n).padStart(2, "0");

/** "25/09/2026", "2026-9-5" → "2026-09-25". Lascia stare ciò che non riconosce. */
export function normalizeDateStr(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  let m;
  m = v.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/); // YYYY-M-D
  if (m) return `${parseInt(m[1], 10)}-${pad2(parseInt(m[2], 10))}-${pad2(parseInt(m[3], 10))}`;
  m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // D-M-YYYY
  if (m) return `${parseInt(m[3], 10)}-${pad2(parseInt(m[2], 10))}-${pad2(parseInt(m[1], 10))}`;
  return v;
}

/** Data pura in UTC. null se il giorno non esiste (31 febbraio compreso). */
export function parseISODate(s) {
  const norm = normalizeDateStr(s);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(norm))) return null;
  const [y, m, d] = norm.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** Data+ora "da parete" (ora alla stazione), quindi costruita in locale. */
export function parseISODateTime(s) {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(String(s))) return null;
  const [date, time] = s.replace("T", " ").split(" ");
  const [y, m, d] = date.split("-").map((x) => parseInt(x, 10));
  const [H, M] = time.split(":").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d, H, M, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Il tetto viene da listings.price numeric(10,2): oltre questo valore non è
// l'app a dire di no, è Postgres — e lo dice con "numeric field overflow".
export const MAX_PRICE = 99999999.99;

/**
 * @param {object} opts
 * @param {object} opts.form   lo stato del modulo
 * @param {string} opts.mode   "create" | "edit"
 * @param {(k:string,d:string,p?:object)=>string} opts.t
 * @param {Date}   [opts.now]  iniettabile per i test sulle date passate
 * @returns {Record<string,string>} campo → messaggio; vuoto = si può pubblicare
 */
export function computeListingErrors({ form, mode, t, now = new Date() }) {
  const ciNorm = normalizeDateStr(form.checkIn);
  const coNorm = normalizeDateStr(form.checkOut);
  const isCerco = String(form.cercoVendo || "").toUpperCase() === "CERCO";
  const e = {};

  if (!String(form.title || "").trim()) e.title = t("createListing.errors.titleRequired", "Titolo obbligatorio.");
  if (form?.type === "train") {
    if (!String(form.routeFrom || "").trim()) e.routeFrom = t("createListing.errors.routeFromRequired", "Stazione di partenza obbligatoria.");
    if (!String(form.routeTo || "").trim()) e.routeTo = t("createListing.errors.routeToRequired", "Stazione di arrivo obbligatoria.");
  } else if (!String(form.location || "").trim()) {
    e.location = t("createListing.errors.locationRequired", "Località obbligatoria.");
  }

  if (form?.type === "hotel") {
    if (!ciNorm) e.checkIn = t("createListing.errors.checkInRequired", "Check-in obbligatorio.");
    if (!coNorm) e.checkOut = t("createListing.errors.checkOutRequired", "Check-out obbligatorio.");
    if (ciNorm && !parseISODate(ciNorm)) e.checkIn = t("createListing.errors.checkInInvalid", "Check-in non valido (YYYY-MM-DD).");
    if (coNorm && !parseISODate(coNorm)) e.checkOut = t("createListing.errors.checkOutInvalid", "Check-out non valido (YYYY-MM-DD).");
    if (ciNorm && coNorm) {
      const a = parseISODate(ciNorm), b = parseISODate(coNorm);
      // Confronto STRETTO: check-out uguale al check-in vuol dire zero notti,
      // che non è una prenotazione. Prima passava di qui e veniva respinto più
      // avanti dal vincolo chk_listings_hotel_dates_order con un errore di
      // database grezzo invece che da questo messaggio.
      if (a && b && b <= a) e.checkOut = t("createListing.errors.checkoutBeforeCheckin", "Il check-out deve essere successivo al check-in.");
    }
    // Data nel passato: bloccante SOLO in creazione. Un annuncio NUOVO con
    // check-in già trascorso non ha senso; uno ESISTENTE la cui data è nel
    // frattempo passata non deve impedire di correggere un campo non correlato
    // (es. il prezzo) in "Modifica annuncio".
    if (mode !== "edit") {
      const todayStart = new Date(now.toDateString());
      if (!e.checkIn && ciNorm) {
        const a = parseISODate(ciNorm);
        if (a && a < todayStart) e.checkIn = t("createListing.checkAi.localCheckInPast", "Check-in nel passato.");
      }
      if (!e.checkOut && coNorm) {
        const b = parseISODate(coNorm);
        if (b && b < todayStart) e.checkOut = t("createListing.checkAi.localCheckOutPast", "Check-out nel passato.");
      }
    }
  } else {
    const departAt = String(form.departAt || "");
    const arriveAt = String(form.arriveAt || "");
    if (!departAt.trim()) e.departAt = t("createListing.errors.departRequired", "Data/ora partenza obbligatoria.");
    if (!arriveAt.trim()) e.arriveAt = t("createListing.errors.arriveRequired", "Data/ora arrivo obbligatoria.");
    if (departAt && !parseISODateTime(departAt)) e.departAt = t("createListing.errors.departInvalid", "Partenza non valida (YYYY-MM-DD HH:mm).");
    if (arriveAt && !parseISODateTime(arriveAt)) e.arriveAt = t("createListing.errors.arriveInvalid", "Arrivo non valido (YYYY-MM-DD HH:mm).");
    if (departAt && arriveAt) {
      const a = parseISODateTime(departAt), b = parseISODateTime(arriveAt);
      // Stesso confronto stretto del check-out (vincolo chk_listings_train_dates_order).
      if (a && b && b <= a) e.arriveAt = t("createListing.errors.arriveBeforeDepart", "L'arrivo deve essere successivo alla partenza.");
    }
    if (mode !== "edit") {
      if (!e.departAt && departAt) {
        const a = parseISODateTime(departAt);
        if (a && a < now) e.departAt = t("createListing.checkAi.localDepartPast", "Partenza nel passato.");
      }
      if (!e.arriveAt && arriveAt) {
        const b = parseISODateTime(arriveAt);
        if (b && b < now) e.arriveAt = t("createListing.checkAi.localArrivePast", "Arrivo nel passato.");
      }
    }
    if (form.isNamedTicket && !/^(M|F)$/.test(String(form.gender || ""))) {
      e.gender = t("createListing.errors.genderRequired", "Seleziona M o F.");
    }
  }

  const priceStr = String(form.price || "").trim();
  let priceNum = NaN;
  if (!priceStr) e.price = t("createListing.errors.priceRequired", "Prezzo obbligatorio.");
  else {
    priceNum = parseLocalizedNumber(priceStr) ?? NaN;
    if (!Number.isFinite(priceNum)) e.price = t("createListing.errors.priceInvalid", "Prezzo non valido.");
    else if (priceNum < 0) e.price = t("createListing.errors.priceNegative", "Il prezzo non può essere negativo.");
    // Zero: il vincolo a DB è price > 0, non >= 0. Senza questo controllo
    // l'annuncio arrivava fino all'INSERT — dopo aver pagato la verifica AI —
    // per farsi rifiutare da Postgres con un messaggio che non nomina il campo.
    else if (priceNum === 0) e.price = t("createListing.errors.priceZero", "Il prezzo deve essere maggiore di zero. Se lo regali, scrivi 1.");
    else if (priceNum > MAX_PRICE) e.price = t("createListing.errors.priceTooHigh", "Prezzo troppo alto: il massimo è {max}€.", { max: MAX_PRICE });
  }

  // Anti-bagarinaggio: il prezzo di vendita non può superare quello di
  // acquisto (solo per un VENDO; per un CERCO il campo prezzo è il budget).
  if (!isCerco) {
    const purchStr = String(form.purchasePrice || "").trim();
    if (purchStr) {
      const purchNum = parseLocalizedNumber(purchStr) ?? NaN;
      if (!Number.isFinite(purchNum)) e.purchasePrice = t("createListing.errors.purchaseInvalid", "Prezzo di acquisto non valido.");
      else if (purchNum <= 0) e.purchasePrice = t("createListing.errors.purchaseNonPositive", "Il prezzo di acquisto deve essere maggiore di zero.");
      else if (purchNum > MAX_PRICE) e.purchasePrice = t("createListing.errors.priceTooHigh", "Prezzo troppo alto: il massimo è {max}€.", { max: MAX_PRICE });
      else if (Number.isFinite(priceNum) && priceNum > purchNum) {
        e.price = t("createListing.errors.priceAbovePurchase", "Il prezzo di vendita non può superare quello di acquisto ({purchase}€).", { purchase: purchNum });
      }
    }

    // Prezzo dinamico: il minimo deve esistere, essere positivo e non superare
    // il prezzo di vendita attuale (altrimenti la curva "salirebbe").
    if (form.dynamicPricingEnabled) {
      const floorStr = String(form.priceFloor || "").trim();
      if (!floorStr) e.priceFloor = t("createListing.errors.priceFloorRequired", "Prezzo minimo obbligatorio se il prezzo dinamico è attivo.");
      else {
        const floorNum = parseLocalizedNumber(floorStr) ?? NaN;
        if (!Number.isFinite(floorNum)) e.priceFloor = t("createListing.errors.priceFloorInvalid", "Prezzo minimo non valido.");
        else if (floorNum <= 0) e.priceFloor = t("createListing.errors.priceFloorNonPositive", "Il prezzo minimo deve essere maggiore di zero.");
        else if (Number.isFinite(priceNum) && floorNum > priceNum) {
          e.priceFloor = t("createListing.errors.priceFloorAbovePrice", "Il prezzo minimo non può superare il prezzo di vendita.");
        }
      }
    }
  }
  return e;
}

// I campi che vivono sullo STEP 1. Serve a decidere se, quando la
// pubblicazione fallisce, bisogna riportare l'utente indietro per fargli
// vedere l'errore sotto al campo.
//
// "gender" NON è qui, ed è la correzione di un difetto reale: il selettore
// M/F sta sullo step 2, sotto l'interruttore "biglietto nominativo". Essendo
// in questo elenco, un genere mancante spediva l'utente allo step 1 — dove
// quel campo non c'è — cioè esattamente il "premo Pubblica e non succede
// niente" che questo salto doveva eliminare.
export const CAMPI_STEP_1 = ["title", "routeFrom", "routeTo", "location", "checkIn", "checkOut", "departAt", "arriveAt"];
