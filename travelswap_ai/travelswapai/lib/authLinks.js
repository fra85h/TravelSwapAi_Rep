// lib/authLinks.js — lettura dei link di autenticazione (reset password,
// callback OAuth) e costruzione dell'indirizzo di ritorno.
//
// Esiste perché due assunzioni sbagliate su expo-linking avevano rotto il
// reset password in modo silenzioso, su TUTTE le piattaforme:
//
// 1. `Linking.parse()` NON restituisce il frammento dell'URL. I suoi campi
//    sono soltanto { scheme, hostname, path, queryParams } (vedi
//    expo-linking/build/createURL.js). Il codice leggeva `parsed.fragment`:
//    sempre `undefined`, quindi un ramo morto. E con il flusso implicito —
//    quello predefinito del client, `lib/supabase.js` non imposta
//    `flowType` — Supabase mette i token proprio lì, in
//    `#access_token=...&refresh_token=...&type=recovery`. Risultato: il
//    token c'era, nessuno lo leggeva, e la schermata diceva "Link non
//    valido".
//
// 2. `Linking.createURL()` sul web non produce un indirizzo assoluto utile.
//    Sul web `resolveScheme()` torna sempre `https` e `hostUri` è vuoto
//    (Schemes.web.js), quindi `createURL('/auth/reset')` genera
//    `https:///auth/reset` — senza host. Un `redirectTo` così non combacia
//    con nessun indirizzo autorizzato su Supabase, che ripiega sul Site URL.
//
// Qui il parsing è fatto a mano sulla stringa: niente `URL` né
// `URLSearchParams`, la cui implementazione in React Native è parziale e
// varia fra versioni. Sono funzioni pure, testate in
// `__tests__/authLinks.test.js`.
import * as Linking from "expo-linking";

const decodeChunk = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    // Percentuale isolata o sequenza non valida: meglio il valore grezzo
    // che un'eccezione che fa fallire tutto il link.
    return s;
  }
};

const parseQueryString = (input, out) => {
  if (!input) return out;
  for (const pair of input.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeChunk(eq < 0 ? pair : pair.slice(0, eq));
    const value = eq < 0 ? "" : decodeChunk(pair.slice(eq + 1));
    // Primo che vince: la query sta prima del frammento e ha la precedenza.
    if (key && !(key in out)) out[key] = value;
  }
  return out;
};

/**
 * Estrae i parametri di autenticazione da un URL, cercandoli SIA nella query
 * (`?code=...`, flusso PKCE) SIA nel frammento (`#access_token=...`, flusso
 * implicito). Funziona anche con gli schemi nativi (`travelswap://...`).
 *
 * @param {string|null|undefined} url
 * @returns {Record<string,string>} parametri trovati (oggetto vuoto se nessuno)
 */
export function parseAuthParams(url) {
  if (typeof url !== "string" || !url) return {};
  const hash = url.indexOf("#");
  const fragment = hash >= 0 ? url.slice(hash + 1) : "";
  const beforeHash = hash >= 0 ? url.slice(0, hash) : url;
  const q = beforeHash.indexOf("?");
  const query = q >= 0 ? beforeHash.slice(q + 1) : "";

  const out = {};
  parseQueryString(query, out);
  parseQueryString(fragment, out);
  return out;
}

/**
 * Indirizzo a cui Supabase deve rimandare l'utente dopo aver aperto il link
 * ricevuto per email. Sul web va costruito sull'origine corrente: è l'unico
 * modo per ottenere un URL assoluto valido (vedi nota 2 in testa al file).
 *
 * @param {string} path percorso applicativo, es. "/auth/reset"
 */
export function makeAuthRedirectUrl(path) {
  const clean = `/${String(path).replace(/^\/+/, "")}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${clean}`;
  }
  return Linking.createURL(clean, { scheme: "travelswap" });
}
