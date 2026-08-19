// Due consegne dello stesso webhook non devono cancellarsi il lavoro a vicenda.
//
// Facebook ripete le consegne. Prima, upsertListingFromFacebook decideva se
// l'annuncio era NUOVO con una SELECT che precedeva la scrittura: due
// consegne concorrenti leggevano entrambe "non c'è", si dichiaravano
// entrambe padrone della bozza, e se la seconda inciampava su una scrittura
// collegata il suo rollback portava via l'annuncio che la prima aveva appena
// pubblicato.
//
// Ora `isNew` lo dice il database: chi vince l'INSERT possiede la riga, chi
// perde riceve un 23505 dall'indice ux_listings_external e sa di essere il
// secondo — quindi aggiorna e non cancella niente.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const PROPRIETARIO = "11111111-1111-4111-8111-111111111111";
const ID_ESISTENTE = "99999999-9999-4999-8999-999999999999";

// Chi comanda il mock: quale errore risponde l'insert su listings.
let erroreInsert = null;
const operazioni = [];

mock.module("../src/services/trust/computeTrustScore.js", {
  namedExports: {
    computeFullTrustScore: async () => ({ trustScore: 90, moderationFlagged: false, flags: [] }),
  },
});

mock.module("../src/db.js", {
  namedExports: {
    supabase: {
      from(tabella) {
        return {
          insert: (riga) => ({
            select: () => ({
              single: async () => {
                operazioni.push({ op: "insert", tabella, status: riga?.status });
                return erroreInsert
                  ? { data: null, error: erroreInsert }
                  : { data: { id: ID_ESISTENTE }, error: null };
              },
            }),
          }),
          update: (patch) => {
            const catena = {
              eq: () => catena,
              select: () => ({
                single: async () => {
                  operazioni.push({ op: "update", tabella, patch });
                  return { data: { id: ID_ESISTENTE }, error: null };
                },
              }),
              then: (resolve) => resolve({ data: null, error: null }),
            };
            operazioni.push({ op: "update-avviata", tabella, patch });
            return catena;
          },
          upsert: async () => {
            operazioni.push({ op: "upsert", tabella });
            return { data: null, error: null };
          },
          delete: () => ({
            eq: async () => {
              operazioni.push({ op: "delete", tabella });
              return { error: null };
            },
          }),
        };
      },
    },
  },
});

const { upsertListingFromFacebook } = await import("../src/models/fbIngest.js");

const annuncio = () => ({
  channel: "facebook:messenger",
  externalId: "msg-123",
  contactUrl: null,
  rawText: "Vendo biglietto Roma Milano 45 euro",
  parsed: {
    cerco_vendo: "VENDO",
    asset_type: "train",
    from_location: "Roma",
    to_location: "Milano",
    depart_at: "2026-08-05T09:00:00",
    arrive_at: "2026-08-05T12:00:00",
    price: "45",
  },
  ownerId: PROPRIETARIO,
});

const conflittoEsterno = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "ux_listings_external"',
};

// Stesso codice, altro significato: due annunci identici dello stesso utente.
// Non vuol dire "questa riga esiste già".
const duplicatoUtente = {
  code: "23505",
  message: "duplicate active listing for user 1111",
};

function prepara(errore) {
  erroreInsert = errore;
  operazioni.length = 0;
}

test("la prima consegna crea la bozza e la pubblica", async () => {
  prepara(null);
  const esito = await upsertListingFromFacebook(annuncio());

  assert.equal(esito.id, ID_ESISTENTE);
  const inserimenti = operazioni.filter((o) => o.op === "insert" && o.tabella === "listings");
  assert.equal(inserimenti.length, 1);
  // Nasce in pausa: mai un annuncio pubblico e incompleto, nemmeno per un istante.
  assert.equal(inserimenti[0].status, "paused");
  assert.equal(operazioni.filter((o) => o.op === "delete").length, 0);
});

test("la seconda consegna aggiorna e NON cancella", async () => {
  // È il cuore del fix. Prima questa consegna si credeva padrona della riga.
  prepara(conflittoEsterno);
  const esito = await upsertListingFromFacebook(annuncio());

  assert.equal(esito.id, ID_ESISTENTE);
  const suListings = operazioni.filter((o) => o.tabella === "listings");
  assert.ok(suListings.some((o) => o.op === "update"), "la riga esistente va aggiornata");
  assert.equal(
    operazioni.filter((o) => o.op === "delete").length,
    0,
    "una riga che non abbiamo creato noi non si cancella MAI: potrebbe essere già pubblicata",
  );
});

test("un 23505 che parla d'altro non viene scambiato per 'la riga esiste già'", async () => {
  // before_insert_listings_block_duplicate solleva lo stesso codice. Trattarlo
  // come un conflitto di external_id farebbe proseguire su una riga che non
  // esiste; deve invece uscire come errore.
  prepara(duplicatoUtente);
  // PostgREST restituisce un oggetto semplice, non un Error, e il modello lo
  // rilancia com'è: si controllano i campi, non il messaggio di un Error.
  await assert.rejects(
    () => upsertListingFromFacebook(annuncio()),
    (e) => e?.code === "23505" && /duplicate active listing/.test(e?.message || ""),
  );
  assert.equal(operazioni.filter((o) => o.op === "update" && o.tabella === "listings").length, 0);
});
