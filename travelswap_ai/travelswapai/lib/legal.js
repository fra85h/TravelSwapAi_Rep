// lib/legal.js — termini di servizio e informativa privacy.
//
// I documenti NON sono schermate dell'app: sono pagine statiche servite dal
// backend a un indirizzo pubblico. È un requisito degli store (l'informativa
// deve essere raggiungibile da chiunque, senza installare l'app né accedere)
// ed evita di dover mantenere due copie dello stesso testo in tre lingue
// dentro il file delle traduzioni.
import { supabase } from "./supabase";

/**
 * Versione dei documenti attualmente in vigore. Alzandola si richiede una
 * nuova accettazione a TUTTI gli utenti, perché il confronto è sull'uguaglianza
 * esatta: è il modo previsto per notificare una modifica sostanziale.
 * Deve corrispondere alla versione scritta in cima ai due documenti.
 */
export const TERMS_VERSION = "1.0";

// Sul web l'app è servita dallo stesso host del backend (/app), quindi un
// percorso relativo basta e funziona anche se la variabile non è impostata.
// Sul nativo serve invece l'indirizzo assoluto.
const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
export const LEGAL_URLS = {
  privacy: `${base}/legal/privacy`,
  terms: `${base}/legal/termini`,
};

/**
 * Stato di accettazione dell'utente corrente.
 * Ritorna { accepted, version } — accepted è vero solo se la versione
 * registrata è ESATTAMENTE quella in vigore.
 *
 * In caso di errore ritorna accepted:true. Sembra controintuitivo, ma è la
 * scelta giusta: un guasto di rete non deve sbattere fuori dall'app chi ha
 * già accettato, mostrandogli un muro che non può superare proprio perché la
 * rete non va. Il rischio opposto — qualcuno che entra senza aver accettato
 * perché la lettura è fallita — si richiude al primo avvio riuscito.
 */
export async function getTermsAcceptance() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { accepted: true, version: null };
    const { data, error } = await supabase
      .from("profiles")
      .select("terms_accepted_at, terms_version")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    const version = data?.terms_version || null;
    return {
      accepted: !!data?.terms_accepted_at && version === TERMS_VERSION,
      version,
    };
  } catch (e) {
    console.log("[getTermsAcceptance]", e?.message || e);
    return { accepted: true, version: null };
  }
}

/** Registra l'accettazione della versione in vigore. */
export async function acceptTerms() {
  const { data, error } = await supabase.rpc("accept_terms", { p_version: TERMS_VERSION });
  if (error) {
    console.log("[acceptTerms]", error.message);
    throw new Error(error.message || "Impossibile registrare l'accettazione");
  }
  const r = Array.isArray(data) ? data[0] : data;
  return r || null;
}
