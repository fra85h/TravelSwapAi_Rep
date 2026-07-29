// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 8 "Funzionalità collaterali", step 35 "Avvisi di ricerca"): account
// B crea un avviso (CERCO salvato); dopo che A pubblica un annuncio che lo
// soddisfa, deve comparire in "Trovato per te" per B.
//
// Chiama createSavedSearch()/listMyMatches() reali in lib/savedSearches.js
// — entrambe hanno logica applicativa vera (non solo wrapper RPC):
// createSavedSearch normalizza il prezzo con virgola italiana
// (parseLocalizedNumber) e azzera i campi non pertinenti al tipo;
// listMyMatches unisce avvisi + match + annunci in più query e scarta i
// match il cui annuncio non è più attivo. Mock completo del client
// Supabase, stesso approccio dei test precedenti.
const SEARCH_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const LISTING_ACTIVE = "bbbbbbbb-2222-4222-8222-222222222222";
const LISTING_SOLD = "cccccccc-3333-4333-8333-333333333333";

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "99999999-9999-4999-8999-999999999999" } } }),
    },
    from: (table) => {
      if (table === "saved_searches") {
        return {
          insert: (payload) => ({
            select: () => ({
              single: async () => ({ data: { id: "aaaaaaaa-1111-4111-8111-111111111111", ...payload }, error: null }),
            }),
          }),
          select: () => Promise.resolve({
            data: [{ id: "aaaaaaaa-1111-4111-8111-111111111111", type: "train", route_from: "Roma", route_to: "Milano", location: null, max_price: 50 }],
            error: null,
          }),
        };
      }
      if (table === "saved_search_matches") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: [
                  { id: "m1", saved_search_id: "aaaaaaaa-1111-4111-8111-111111111111", listing_id: "bbbbbbbb-2222-4222-8222-222222222222", matched_at: "2026-07-29T10:00:00Z", seen: false },
                  { id: "m2", saved_search_id: "aaaaaaaa-1111-4111-8111-111111111111", listing_id: "cccccccc-3333-4333-8333-333333333333", matched_at: "2026-07-29T09:00:00Z", seen: false },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { id: "bbbbbbbb-2222-4222-8222-222222222222", title: "Roma → Milano, Frecciarossa 9506", status: "active" },
                { id: "cccccccc-3333-4333-8333-333333333333", title: "Roma → Milano, venduto ieri", status: "sold" },
              ],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`fake supabase: tabella non gestita: ${table}`);
    },
  },
}));

import { createSavedSearch, listMyMatches } from "../lib/savedSearches";

test("Avvisi di ricerca: B crea un avviso con budget in formato italiano", async () => {
  const search = await createSavedSearch({
    type: "train",
    routeFrom: "Roma",
    routeTo: "Milano",
    maxPrice: "45,50",
  });

  expect(search.type).toBe("train");
  // L'avviso cerca annunci VENDO che soddisfano il criterio (un CERCO non è
  // mai qualcosa da segnalare): cerco_vendo qui descrive il TARGET
  // dell'avviso, non la propria offerta.
  expect(search.cerco_vendo).toBe("VENDO");
  expect(search.route_from).toBe("Roma");
  expect(search.route_to).toBe("Milano");
  expect(search.max_price).toBe(45.5);
});

test("Avvisi di ricerca: 'Trovato per te' mostra solo i match ancora attivi", async () => {
  const matches = await listMyMatches();

  // Stesso "atteso" della checklist manuale, step 35: l'annuncio pubblicato
  // da A compare in Trovato per te; un match il cui annuncio non è più
  // attivo (venduto altrove) non deve comparire.
  expect(matches).toHaveLength(1);
  expect(matches[0].listing.id).toBe(LISTING_ACTIVE);
  expect(matches[0].listing.status).toBe("active");
  expect(matches[0].search.id).toBe(SEARCH_ID);
  expect(matches.some((m) => m.listing?.id === LISTING_SOLD)).toBe(false);
});
