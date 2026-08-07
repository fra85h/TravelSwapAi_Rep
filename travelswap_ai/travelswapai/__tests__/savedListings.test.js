// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 8 "Funzionalità collaterali", step 36 "Preferiti"): salva un
// annuncio, verifica che compaia nella lista Preferiti.
//
// Chiama saveListing()/listSavedListings() reali in lib/savedListings.js.
// saveListing() e idempotente per costruzione: la chiave primaria di
// saved_listings e la coppia (user_id, listing_id), quindi un upsert con
// ignoreDuplicates basta. Prima c'era una isSaved() prima dell'insert, con
// sopra scritto "evita duplicati anche senza vincolo unico": il vincolo pero
// c'e da sempre, ed era un viaggio in piu a ogni stellina.
// listSavedListings() appiattisce il join nidificato listing:listing_id e
// scarta annunci cancellati (join nullo). Mock completo del client
// Supabase, stesso approccio dei test precedenti.
const ME = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "bbbbbbbb-2222-4222-8222-222222222222";

const mockUpsert = jest.fn(async () => ({ error: null }));
const mockMaybeSingle = jest.fn(async () => ({ data: null, error: null }));

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
                  maybeSingle: mockMaybeSingle,
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
        upsert: (payload, opts) => mockUpsert(payload, opts),
      };
    },
  },
}));

import { saveListing, listSavedListings } from "../lib/savedListings";

test("Preferiti: salva un annuncio e lo ritrova nella lista Preferiti", async () => {
  await saveListing(LISTING_ID);

  // Stesso "atteso" della checklist manuale, step 36: la riga viene scritta
  // con l'utente e l'annuncio corretti.
  expect(mockUpsert).toHaveBeenCalledWith(
    { user_id: ME, listing_id: LISTING_ID },
    { onConflict: "user_id,listing_id", ignoreDuplicates: true },
  );

  // ...e senza una lettura preliminare: il doppio salvataggio lo impedisce
  // gia la chiave primaria, quindi quel viaggio in piu era solo ritardo fra
  // il tocco e la stella piena.
  expect(mockMaybeSingle).not.toHaveBeenCalled();

  const saved = await listSavedListings();
  expect(saved).toHaveLength(1);
  expect(saved[0].id).toBe(LISTING_ID);
  expect(saved[0].title).toBe("Roma → Milano, Frecciarossa 9506");
});
