// Le date e gli orari degli annunci si leggono "da parete".
//
// Partenza e arrivo indicano l'ora ALLA STAZIONE: chi guarda l'annuncio da
// Madrid deve leggere lo stesso 07:31 che ha scritto chi lo ha pubblicato da
// Roma, perché è l'ora stampata sul biglietto. Per questo il valore è
// salvato naive — la stringa "2026-07-18T07:31" arriva a Postgres senza
// offset e finisce come 07:31+00 — e va riletto in UTC. Usare `toLocale*`
// qui significa applicare il fuso di chi guarda a un valore che un fuso non
// ce l'ha: in Italia comparivano +2 ore, e a cavallo di mezzanotte anche il
// giorno sbagliato.
//
// check_in/check_out sono colonne `date` ("2026-07-18"): `new Date()` le
// interpreta a mezzanotte UTC, quindi leggerle in UTC è ugualmente l'unico
// modo per riottenere il giorno che ci è stato scritto.
//
// Questo modulo esiste perché la regola stava in una sola schermata mentre
// altre quattro formattavano le stesse colonne con toLocaleDateString: lo
// stesso treno compariva con due giorni diversi a seconda di dove lo si
// guardava. Regola sola, un posto solo, coperta da test.

const pad2 = (n) => String(n).padStart(2, "0");

// Nomi brevi costruiti a mano, non da Intl: servono in UTC, e le
// implementazioni di Intl su Hermes non sono uniformi fra le piattaforme.
export const WD_SHORT = {
  it: ["dom", "lun", "mar", "mer", "gio", "ven", "sab"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
};

export const MON_SHORT = {
  it: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
};

const lingua = (locale) => (["it", "en", "es"].includes(locale) ? locale : "it");

/** La data letta in UTC, oppure null se non è una data. */
function comeData(input) {
  if (!input) return null;
  const d = new Date(String(input));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formato esteso per la scheda annuncio, es. "sab 18 lug 2026 · 07:31".
 * Con withTime=false mostra solo giorno/mese/anno (per le date secche).
 * Su input illeggibile restituisce l'input stesso: meglio mostrare la
 * stringa grezza che un "Invalid Date".
 */
export function formatWallClock(input, locale = "it", withTime = true) {
  if (!input) return "—";
  const d = comeData(input);
  if (!d) return String(input);
  const lang = lingua(locale);
  const datePart = `${WD_SHORT[lang][d.getUTCDay()]} ${d.getUTCDate()} ${MON_SHORT[lang][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (!withTime) return datePart;
  return `${datePart} · ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * Formato corto per gli elenchi, es. "18 lug". Sostituisce le chiamate a
 * toLocaleDateString(locale, { day: "2-digit", month: "short" }): stesso
 * aspetto in italiano, ma letto in UTC invece che nel fuso del telefono.
 * Su input illeggibile restituisce stringa vuota, come faceva il catch di
 * quei formattatori: in un elenco fitto una data rotta è rumore, non
 * informazione.
 */
export function formatWallShortDate(input, locale = "it") {
  const d = comeData(input);
  if (!d) return "";
  const lang = lingua(locale);
  return `${pad2(d.getUTCDate())} ${MON_SHORT[lang][d.getUTCMonth()]}`;
}
