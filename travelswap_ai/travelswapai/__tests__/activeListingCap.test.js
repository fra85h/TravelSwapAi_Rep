// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 6 "Rami alternativi", step 26 "Cap annunci attivi"): un account con
// già 10 annunci attivi non può pubblicarne un 11°. Chiama
// countMyActiveListings() reale in lib/db.js — il pre-check lato client
// usato da CreateListingScreen prima di permettere "Pubblica" — con un mock
// completo del client Supabase, stesso approccio dei test precedenti.
//
// Il backstop vero è il trigger Postgres enforce_active_listing_cap
// (20260723110000_active_listing_cap.sql, cap = 10 hardcoded, stesso
// valore di ACTIVE_LISTING_CAP qui): un mock non lo esercita, resta
// coperto dalla checklist manuale (l'unico modo per provare davvero un
// INSERT respinto dal DB).
import { countMyActiveListings, ACTIVE_LISTING_CAP } from "../lib/db";

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "88888888-8888-4888-8888-888888888888" } } }, error: null }),
      getUser: async () => ({ data: { user: { id: "88888888-8888-4888-8888-888888888888" } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ count: 10, error: null }),
        }),
      }),
    }),
  },
}));

test("Cap annunci attivi: 10 annunci attivi raggiungono il tetto", async () => {
  expect(ACTIVE_LISTING_CAP).toBe(10);

  const activeCount = await countMyActiveListings();

  // Stesso "atteso" della checklist manuale, step 26: al decimo annuncio
  // attivo il tetto è già raggiunto, un undicesimo va bloccato.
  expect(activeCount).toBe(10);
  expect(activeCount >= ACTIVE_LISTING_CAP).toBe(true);
});
