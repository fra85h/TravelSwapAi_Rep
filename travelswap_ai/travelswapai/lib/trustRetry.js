// lib/trustRetry.js — riprende i Check AI rimasti indietro.
//
// Quando la verifica AI fallisce (quota OpenAI, 429, servizio giù) l'annuncio
// non riceve nessun punteggio e viene marcato con trust_pending_at. Senza
// qualcosa che lo riprenda, resterebbe "in verifica" per sempre: un'etichetta
// che non si risolve mai è peggio di un numero sbagliato, perché i compratori
// imparano a ignorarla.
//
// Non c'è uno scheduler nel progetto, e non ne serve uno: la manutenzione
// periodica si aggancia a una schermata che l'utente apre comunque. È lo
// stesso schema già usato per expire_my_stale_listings (Profilo) e
// release_my_stale_reservations (offerte).
import { supabase } from "./supabase";
import { fetchJson } from "./backendApi";
import { normalizeFormToListing } from "./useTrustScore";

/** Rilancia la verifica su UN annuncio già esistente, con le sue foto. */
async function verificaAnnuncio(listingId, locale) {
  const { data: l, error } = await supabase
    .from("listings")
    .select("id, title, description, type, location, route_from, route_to, depart_at, arrive_at, check_in, check_out, price, currency, cerco_vendo")
    .eq("id", listingId)
    .single();
  if (error || !l) return null;

  const { data: foto } = await supabase
    .from("listing_images")
    .select("url")
    .eq("listing_id", listingId)
    .order("position", { ascending: true })
    .limit(2);

  const isTrain = String(l.type || "").toLowerCase() !== "hotel";
  const listing = normalizeFormToListing({
    id: l.id,
    type: l.type,
    cerco_vendo: l.cerco_vendo,
    title: l.title,
    description: l.description,
    origin: isTrain ? l.route_from : null,
    destination: isTrain ? l.route_to : null,
    location: isTrain ? null : l.location,
    departAt: l.depart_at,
    arriveAt: l.arrive_at,
    checkIn: l.check_in,
    checkOut: l.check_out,
    price: l.price,
    currency: l.currency || "EUR",
    images: (foto || []).filter((f) => f?.url).map((f) => ({ url: f.url })),
  });

  // L'id DEVE arrivare al server: è quello che lega il trust_audit
  // all'annuncio e fa scattare il trigger che scrive il punteggio e azzera
  // trust_pending_at. Senza, la verifica riuscirebbe e non cambierebbe nulla.
  return fetchJson("/ai/trustscore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listing: { ...listing, id: listingId }, locale }),
    timeoutMs: 45000,
  });
}

// Pochi per volta: ogni verifica è una chiamata AI, e l'obiettivo è recuperare
// il ritardo senza trasformare l'apertura del Profilo in una raffica di
// richieste — che è poi la causa (429) per cui questi annunci sono qui.
const MAX_PER_GIRO = 3;

// Freno di sicurezza. Chi chiama questa funzione ricarica la schermata quando
// qualcosa si risolve, e quella ricarica richiama questa funzione: il giro si
// chiude da solo SOLO se gli annunci risolti smettono davvero di risultare in
// sospeso. Basta che trust_pending_at non venga azzerato — per esempio perché
// la migration 20260726140000 non è ancora stata applicata a DB — e diventa un
// ciclo infinito che martella l'AI, cioè esattamente il guasto (429) che ha
// creato questi annunci. Il freno non dipende da quel presupposto.
const PAUSA_MS = 2 * 60 * 1000;
let ultimoGiro = 0;

/**
 * Rilancia la verifica sugli annunci dell'utente rimasti in sospeso.
 * Non lancia mai: è manutenzione in sottofondo, un errore qui non deve
 * rompere la schermata che l'ha chiamata.
 *
 * @returns {Promise<{tentati:number, risolti:number}>}
 */
export async function retryPendingTrustChecks({ locale = "it" } = {}) {
  let tentati = 0, risolti = 0;

  const ora = Date.now();
  if (ora - ultimoGiro < PAUSA_MS) return { tentati, risolti };
  ultimoGiro = ora;

  try {
    const { data, error } = await supabase.rpc("list_my_listings_pending_trust", {
      max_rows: MAX_PER_GIRO,
    });
    if (error || !Array.isArray(data) || !data.length) return { tentati, risolti };

    for (const riga of data.slice(0, MAX_PER_GIRO)) {
      tentati++;
      try {
        const res = await verificaAnnuncio(riga.id, locale);
        // Riuscita = l'AI ha risposto. Il punteggio lo scrive il trigger sul
        // trust_audit, che azzera anche trust_pending_at: qui non si scrive
        // niente su listings, così non c'è modo di sfasare i due valori.
        if (res && res.verificationPending !== true) risolti++;
      } catch {
        // Il servizio è ancora giù: si riproverà alla prossima apertura.
      }
    }
  } catch {
    // Nessun rumore: se la RPC non è ancora stata applicata a DB, il ritentativo
    // semplicemente non fa nulla.
  }
  return { tentati, risolti };
}
