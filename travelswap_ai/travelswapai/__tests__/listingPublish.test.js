// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 1 "Pubblicazione annuncio (account A)", step 1+3): account A crea a
// mano un treno VENDO con tratta reale, data futura e prezzo, poi pubblica.
// Chiama insertListing() reale (lib/db.js) — lo stesso codice dietro il
// tasto "Pubblica" in screens/CreateListingScreen.js — con un mock completo
// del client Supabase: simula le risposte del DB (sessione autenticata,
// insert riuscito) invece di una chiamata di rete vera.
//
// Motivo del mock (non un test live contro Supabase reale): l'ambiente di
// sviluppo di questa sessione ha un blocco di rete (403) verso il progetto
// Supabase. Fuori scope qui, come per l'equivalente lato server
// (server/test/createListingPublish.test.js): trigger Postgres (whitelist
// tratte, cap annunci, trust_score) e RLS, che un mock non esercita.
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: ACCOUNT_A } } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: ACCOUNT_A } },
        error: null,
      }),
    },
    from: () => ({
      insert: (rows) => ({
        select: () => ({
          single: async () => ({
            data: { id: "fake-listing-id-0001", ...rows[0] },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

import { insertListing } from "../lib/db";

test("Pubblicazione annuncio (account A): treno VENDO, tratta reale, data futura, prezzo", async () => {
  const departAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // +7 giorni
  const arriveAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString(); // +3h di viaggio

  const listing = await insertListing({
    type: "train",
    title: "Roma → Milano, Frecciarossa 9506",
    description: "Biglietto singolo, non cambiabile, ceduto per impegno improvviso.",
    cerco_vendo: "VENDO",
    route_from: "Roma",
    route_to: "Milano",
    depart_at: departAt,
    arrive_at: arriveAt,
    price: 45,
  });

  // Stesso "atteso" della checklist manuale, step 3.
  expect(listing.status).toBe("active");
  expect(listing.cerco_vendo).toBe("VENDO");
  expect(listing.type).toBe("train");
  expect(listing.route_from).toBe("Roma");
  expect(listing.route_to).toBe("Milano");
  expect(listing.price).toBe(45);
  expect(listing.user_id).toBe(ACCOUNT_A);
});
