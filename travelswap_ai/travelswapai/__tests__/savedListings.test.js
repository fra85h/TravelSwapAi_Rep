// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 8 "Funzionalità collaterali", step 36 "Preferiti"): salva un
// annuncio, verifica che compaia nella lista Preferiti.
//
// Chiama saveListing()/listSavedListings() reali in lib/savedListings.js —
// saveListing() ha logica applicativa vera (idempotente: controlla prima
// con isSaved() per evitare un duplicato anche senza vincolo unico a DB);
// listSavedListings() appiattisce il join nidificato listing:listing_id e
// scarta annunci cancellati (join nullo). Mock completo del client
// Supabase, stesso approccio dei test precedenti.
const ME = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "bbbbbbbb-2222-4222-8222-222222222222";

const mockInsert = jest.fn(async () => ({ error: null }));

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "99999999-9999-4999-8999-999999999999" } } }),
    },
    from: (table) => {
      if (table !== "saved_listings") throw new Error(`fake: tabella non gestita: ${table}`);
      return {
        select: (cols) => {
          if (cols === "listing_id") {
            // isSaved(): non ancora salvato la prima volta.
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            };
          }
          // listSavedListings(): il join nidificato listing:listing_id.
          return {
            eq: () => ({
              order: async () => ({
                data: [{
                  created_at: "2026-07-29T10:00:00Z",
                  listing: { id: "bbbbbbbb-2222-4222-8222-222222222222", title: "Roma → Milano, Frecciarossa 9506", status: "active" },
                }],
                error: null,
              }),
            }),
          };
        },
        insert: (payload) => mockInsert(payload),
      };
    },
  },
}));

import { saveListing, listSavedListings } from "../lib/savedListings";

test("Preferiti: salva un annuncio e lo ritrova nella lista Preferiti", async () => {
  await saveListing(LISTING_ID);

  // Stesso "atteso" della checklist manuale, step 36: l'insert avviene con
  // l'utente e l'annuncio corretti (idempotente: prima ha controllato che
  // non fosse già salvato).
  expect(mockInsert).toHaveBeenCalledWith({ user_id: ME, listing_id: LISTING_ID });

  const saved = await listSavedListings();
  expect(saved).toHaveLength(1);
  expect(saved[0].id).toBe(LISTING_ID);
  expect(saved[0].title).toBe("Roma → Milano, Frecciarossa 9506");
});
