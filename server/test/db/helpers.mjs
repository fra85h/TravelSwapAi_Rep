// Impalcatura per i test che girano contro un Postgres VERO.
//
// Perché esistono. Tutti gli altri test sostituiscono il client Supabase con
// un finto: verificano che il server chiami la funzione giusta con i
// parametri giusti, non che quella funzione faccia la cosa giusta. Tutto il
// plpgsql — trigger, vincoli, RLS — non viene mai eseguito. È il motivo per
// cui due guasti sono arrivati in produzione con la CI verde:
//
//   • `_norm(offers.status)` senza cast a text: ogni accettazione di
//     offerta falliva, sempre;
//   • `notifications_type_check` ricostruito da una versione vecchia:
//     l'inserimento della notifica faceva fallire l'intera transazione.
//
// Entrambi vivevano interamente dentro il database. Nessun mock poteva
// vederli.
//
// COME GIRANO. Ogni test apre la sua connessione, fa BEGIN e alla fine
// ROLLBACK: nessun test lascia tracce, l'ordine non conta e il database non
// va ricreato fra un test e l'altro. Senza DATABASE_URL i test si saltano
// da soli, così `npm test` in locale resta veloce e senza prerequisiti.
import pg from "pg";

export const motivoSkip = process.env.DATABASE_URL
  ? false
  : "DATABASE_URL non impostata (test su Postgres reale: vedi server/README o il job test-db)";

/** Connessione dentro una transazione che verrà annullata. */
export async function apri() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("BEGIN");
  return c;
}

export async function chiudi(c) {
  if (!c) return;
  await c.query("ROLLBACK").catch(() => {});
  await c.end().catch(() => {});
}

export async function creaUtente(c, email) {
  const { rows } = await c.query(
    "insert into auth.users (email) values ($1) returning id",
    [email || `u${Math.random().toString(36).slice(2)}@example.test`],
  );
  return rows[0].id;
}

/**
 * Un annuncio valido.
 *
 * Il prezzo predefinito è casuale di proposito: un trigger blocca due
 * annunci attivi dello stesso utente con stesso tipo, stessa tratta e
 * stesso prezzo. Con un prezzo fisso, il secondo annuncio di ogni test
 * fallirebbe per un motivo che col test non c'entra niente.
 */
export async function creaAnnuncio(c, opts = {}) {
  const {
    userId,
    cercoVendo = "VENDO",
    type = "train",
    status = "active",
    title = "Annuncio di prova",
    location = "Roma-->Milano",
    routeFrom = "Roma",
    routeTo = "Milano",
    departAt = null,
    price = Math.round(Math.random() * 100000) / 100,
    acceptsSwap = true,
  } = opts;

  const { rows } = await c.query(
    `insert into public.listings
       (user_id, type, title, location, price, status, cerco_vendo,
        route_from, route_to, depart_at, accepts_swap)
     values ($1, $2::listing_type, $3, $4, $5, $6::listing_status, $7, $8, $9, $10, $11)
     returning id`,
    [userId, type, title, location, price, status, cercoVendo,
      routeFrom, routeTo, departAt, acceptsSwap],
  );
  return rows[0].id;
}

export async function creaOfferta(c, { proposerId, toListingId, fromListingId = null, type = "buy", amount = null }) {
  const { rows } = await c.query(
    `insert into public.offers (proposer_id, to_listing_id, from_listing_id, type, amount)
     values ($1, $2, $3, $4, $5) returning id, status`,
    [proposerId, toListingId, fromListingId, type, amount],
  );
  return rows[0];
}

/**
 * Esegue come utente autenticato, esattamente come fa Supabase: il ruolo
 * `authenticated` più la claim `sub` nel JWT, che è ciò che auth.uid()
 * legge. Provare la RLS impersonando un utente per finta (con l'utente
 * proprietario del database, che le policy le scavalca) proverebbe solo che
 * il test è scritto male.
 */
export async function comeUtente(c, userId, fn) {
  await c.query("SAVEPOINT come_utente");
  await c.query("SET LOCAL ROLE authenticated");
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  try {
    return await fn();
  } finally {
    await c.query("RESET ROLE").catch(() => {});
    await c.query(`SELECT set_config('request.jwt.claims', '', true)`).catch(() => {});
  }
}

/** Il messaggio dell'errore Postgres, o null se non è stato sollevato niente. */
export async function erroreDi(promessa) {
  try {
    await promessa;
    return null;
  } catch (e) {
    return e.message;
  }
}
