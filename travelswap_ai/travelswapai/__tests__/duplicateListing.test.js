// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 6 "Rami alternativi", step 27 "Duplicato"): pubblicare due annunci
// con stessa tratta/data/prezzo sullo stesso account — il secondo deve
// essere bloccato o segnalato come "molto simile".
//
// findMyDuplicateActiveListing() in lib/db.js fa tutto il confronto in
// JS (non solo un wrapper RPC come gli altri test di questa serie): legge
// gli annunci attivi dello stesso tipo dell'account e classifica il
// candidato come "exact" (stessa tratta/data/prezzo — vero duplicato) o
// "similar" (stessa tratta ma data/prezzo diversi). Mock completo del
// client Supabase, stesso approccio dei test precedenti.
const EXISTING_LISTING = {
  id: "99999999-9999-4999-8999-999999999999",
  title: "Roma → Milano, Frecciarossa 9506",
  type: "train",
  location: null,
  route_from: "Roma",
  route_to: "Milano",
  depart_at: "2026-08-05T09:00:00Z",
  check_in: null,
  price: 45,
  status: "active",
};

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "88888888-8888-4888-8888-888888888888" } } }, error: null }),
      getUser: async () => ({ data: { user: { id: "88888888-8888-4888-8888-888888888888" } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: async () => ({
              data: [{
                id: "99999999-9999-4999-8999-999999999999",
                title: "Roma → Milano, Frecciarossa 9506",
                type: "train",
                location: null,
                route_from: "Roma",
                route_to: "Milano",
                depart_at: "2026-08-05T09:00:00Z",
                check_in: null,
                price: 45,
                status: "active",
              }],
              error: null,
            }),
          }),
        }),
      }),
    }),
  },
}));

import { findMyDuplicateActiveListing } from "../lib/db";

test("Duplicato: stessa tratta, stessa data, stesso prezzo -> exact", async () => {
  const result = await findMyDuplicateActiveListing({
    type: "train",
    route_from: "Roma",
    route_to: "Milano",
    depart_at: "2026-08-05T10:30:00Z", // stesso giorno, ora diversa: sameDay confronta solo la data
    price: 45,
  });

  // Stesso "atteso" della checklist manuale, step 27: vero duplicato.
  expect(result.exact).toBeTruthy();
  expect(result.exact.id).toBe(EXISTING_LISTING.id);
  expect(result.similar).toBeNull();
});

test("Duplicato: stessa tratta ma data/prezzo diversi -> similar, non exact", async () => {
  const result = await findMyDuplicateActiveListing({
    type: "train",
    route_from: "Roma",
    route_to: "Milano",
    depart_at: "2026-08-12T09:00:00Z", // giorno diverso
    price: 60, // prezzo diverso
  });

  expect(result.exact).toBeNull();
  expect(result.similar).toBeTruthy();
  expect(result.similar.id).toBe(EXISTING_LISTING.id);
});

test("Nessun duplicato: tratta diversa -> né exact né similar", async () => {
  const result = await findMyDuplicateActiveListing({
    type: "train",
    route_from: "Napoli",
    route_to: "Bari",
    depart_at: "2026-08-05T09:00:00Z",
    price: 45,
  });

  expect(result.exact).toBeNull();
  expect(result.similar).toBeNull();
});
