// Due giri del cron non devono mandare due volte lo stesso avviso.
//
// recomputeDynamicPrices legge savers_notified_price, decide se il ribasso
// merita di essere annunciato a chi ha salvato l'annuncio, e poi scrive. Fra
// la lettura e la scrittura, prima, non c'era niente: due esecuzioni
// sovrapposte leggevano lo stesso riferimento, decidevano entrambe di
// avvisare, e chi aveva salvato l'annuncio riceveva la stessa notifica due
// volte.
//
// Le difese sono due, e questo file prova la seconda. La prima è il turno
// (withCronLease) che impedisce ai due giri di partire insieme; ma un turno
// ha una scadenza, quindi da sola non basta. La seconda è un compare-and-set:
// la scrittura passa solo se savers_notified_price è ANCORA quello letto. Chi
// arriva secondo non trova più il valore che si aspettava, non tocca niente,
// e non annuncia niente.
//
// Sta in un file suo e non in priceDecay.test.js per il motivo spiegato nella
// testata di quel file: con un modulo intermedio fra la route e db.js, un
// secondo mock.module nello stesso file non rimpiazza il binding già risolto.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const GIORNO = 24 * 60 * 60 * 1000;

/**
 * Un annuncio a metà della finestra di decadimento: 100 -> 70, cioè un calo
 * del 30%, ben oltre la soglia del 5% che fa scattare l'avviso.
 */
const ANNUNCIO = {
  id: "listing-1",
  user_id: "seller-1",
  title: "Roma → Milano",
  price: 100,
  list_price: 100,
  price_floor: 40,
  depart_at: new Date(Date.now() + 3.5 * GIORNO).toISOString(),
  check_in: null,
  status: "active",
  savers_notified_price: null, // mai annunciato: il riferimento è list_price
};

test("chi arriva secondo non riscrive e non annuncia", async () => {
  const scritture = [];
  const notifiche = [];
  const letturePreferiti = [];

  mock.module("../src/lib/push.js", {
    namedExports: { sendExpoPush: async () => ({ sent: 0 }) },
  });

  mock.module("../src/db.js", {
    namedExports: {
      supabase: {
        from(tabella) {
          if (tabella === "listings") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    not: () => ({
                      not: async () => ({ data: [ANNUNCIO], error: null }),
                    }),
                  }),
                }),
              }),
              update: (patch) => {
                const filtri = [];
                const catena = {
                  eq: (col, val) => { filtri.push({ op: "eq", col, val }); return catena; },
                  is: (col, val) => { filtri.push({ op: "is", col, val }); return catena; },
                  // ZERO righe: è come si presenta "un altro giro ci è
                  // arrivato prima". Il filtro sul riferimento non trova più
                  // il valore letto, quindi Postgres non aggiorna niente.
                  select: async () => {
                    scritture.push({ patch, filtri });
                    return { data: [], error: null };
                  },
                };
                return catena;
              },
            };
          }
          if (tabella === "saved_listings") {
            return {
              select: () => ({
                in: async (col, ids) => {
                  letturePreferiti.push(ids);
                  return { data: [{ user_id: "anna", listing_id: "listing-1" }], error: null };
                },
              }),
            };
          }
          if (tabella === "notifications") {
            return { insert: async (riga) => { notifiche.push(riga); return { error: null }; } };
          }
          throw new Error(`tabella non mockata: ${tabella}`);
        },
      },
    },
  });

  const { recomputeDynamicPrices } = await import("../src/models/priceDecay.js");
  const esito = await recomputeDynamicPrices();

  // Il tentativo di scrittura c'è stato: il secondo giro non sa in anticipo
  // di essere secondo, lo scopre solo provando.
  assert.equal(scritture.length, 1);

  // Ed è partito con il compare-and-set addosso. Senza questo filtro la
  // scrittura sarebbe passata e la notifica sarebbe partita di nuovo.
  const suRiferimento = scritture[0].filtri.find((f) => f.col === "savers_notified_price");
  assert.ok(suRiferimento, "la update deve filtrare su savers_notified_price");
  assert.equal(suRiferimento.op, "is", "riferimento mai scritto: il confronto giusto è IS NULL");
  assert.equal(suRiferimento.val, null);

  // Nessuna riga toccata, quindi niente è successo davvero:
  assert.equal(esito.updated, 0, "una riga non toccata non è un aggiornamento");
  assert.equal(notifiche.length, 0, "nessuna notifica, né al venditore né a chi ha salvato");
  assert.equal(letturePreferiti.length, 0, "nemmeno la lettura dei preferiti deve partire");
});
