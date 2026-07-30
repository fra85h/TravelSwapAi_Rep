// Chiude il gap segnalato in #221: report_chain_problem (creata in #218)
// non aveva nessun bottone da nessuna parte nell'app, perché ChainChatScreen
// non sapeva CHI fossero gli altri 2 partecipanti (solo chainId/giveTitle/
// receiveTitle nei route params, niente user_id o nomi). getChainParticipants()
// in lib/chains.js risolve questo: legge chain_participants + listings +
// profili pubblici e ritorna gli ALTRI partecipanti (io escluso) con nome.
//
// Mock completo di ../lib/supabase (query dirette) e ../lib/db
// (getPublicProfilesByIds, riusato da altre funzioni del progetto).
const CHAIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";
const L_ME = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const L_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const L_C = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } }) },
    from: (table) => {
      if (table === "chain_participants") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                { user_id: ME, give_listing_id: L_ME },
                { user_id: USER_B, give_listing_id: L_B },
                { user_id: USER_C, give_listing_id: L_C },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "listings") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { id: L_B, title: "Napoli → Bari" },
                { id: L_C, title: "Torino → Genova" },
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

jest.mock("../lib/db", () => ({
  getPublicProfilesByIds: async (ids) =>
    [
      { id: "22222222-2222-4222-8222-222222222222", full_name: "Bruno Bianchi", username: "bruno_b" },
      { id: "33333333-3333-4333-8333-333333333333", full_name: null, username: "carla_c" },
    ].filter((p) => ids.map(String).includes(p.id)),
}));

import { getChainParticipants } from "../lib/chains";

test("getChainParticipants: ritorna solo gli ALTRI partecipanti, con nome e cosa cedono", async () => {
  const others = await getChainParticipants(CHAIN_ID);

  expect(others).toHaveLength(2);
  expect(others.some((p) => p.userId === ME)).toBe(false); // io escluso

  const b = others.find((p) => p.userId === USER_B);
  expect(b.displayName).toBe("Bruno Bianchi");
  expect(b.giveTitle).toBe("Napoli → Bari");

  // full_name assente: ripiega su username, mai su null nudo.
  const c = others.find((p) => p.userId === USER_C);
  expect(c.displayName).toBe("carla_c");
  expect(c.giveTitle).toBe("Torino → Genova");
});
