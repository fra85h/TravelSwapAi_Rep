// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 7 "Scambio a 3", step 30): ciascuno dei 3 account apre "Scambi a 3"
// e vede il box "Tu cedi"/"Tu ricevi" e i pallini di stato. Chiama
// listMyChainProposals() reale in lib/chains.js — a differenza di
// confirmChain()/declineChain() (wrapper sottili sulle RPC
// confirm_chain_participant/decline_chain_participant, già coperte da
// migrationsIntegrity.test.js per il lock ordinato) questa funzione fa
// tutta l'aggregazione in JS: raggruppa i partecipanti, li ordina, calcola
// confirmedCount/myConfirmed/myReceiveListing — logica applicativa vera,
// non solo un passa-carte verso una RPC.
//
// Mock completo del client Supabase, stesso approccio dei test precedenti.
const CHAIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";
const L_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // annuncio ceduto da B
const L_ME = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // annuncio ceduto da me
const L_C = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // annuncio ceduto da C

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } }),
    },
    from: (table) => {
      if (table === "chain_participants") {
        return {
          select: () => ({
            // Prima query in listMyChainProposals: solo le mie righe (chain_id).
            eq: async () => ({ data: [{ chain_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }], error: null }),
            // Seconda query: tutte le righe dei partecipanti della catena.
            in: async () => ({
              data: [
                { chain_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 0, user_id: "22222222-2222-4222-8222-222222222222", give_listing_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", receive_listing_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", confirmed: true, confirmed_at: "2026-07-29T10:00:00Z" },
                { chain_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 1, user_id: "11111111-1111-4111-8111-111111111111", give_listing_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", receive_listing_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", confirmed: true, confirmed_at: "2026-07-29T10:05:00Z" },
                { chain_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 2, user_id: "33333333-3333-4333-8333-333333333333", give_listing_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", receive_listing_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", confirmed: false, confirmed_at: null },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "chain_proposals") {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({
                data: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "proposed", created_at: "2026-07-29T09:00:00Z", expires_at: null, explanation: "Cerchio da 3" }],
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
                { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Napoli → Bari", type: "train" },
                { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Roma → Milano", type: "train" },
                { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Torino → Genova", type: "train" },
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

import { listMyChainProposals } from "../lib/chains";

test("Scambio a 3: aggrega partecipanti, ordine, conferme e ricezione", async () => {
  const proposals = await listMyChainProposals();

  expect(proposals).toHaveLength(1);
  const chain = proposals[0];
  expect(chain.id).toBe(CHAIN_ID);

  // Stesso "atteso" della checklist manuale, step 30: 2 di 3 hanno confermato.
  expect(chain.confirmedCount).toBe(2);
  expect(chain.myConfirmed).toBe(true);
  expect(chain.myReceiveListing.title).toBe("Torino → Genova"); // quello che ricevo da C

  // Ordine DISCENDENTE per posizione (2, 1, 0), non quello di arrivo dal DB.
  expect(chain.participants.map((p) => p.position)).toEqual([2, 1, 0]);

  const mine = chain.participants.find((p) => p.isMe);
  expect(mine.user_id).toBe(ME);
  expect(mine.listing.title).toBe("Roma → Milano"); // quello che cedo io
  expect(mine.receiveListing.title).toBe("Torino → Genova");

  const notConfirmedYet = chain.participants.find((p) => p.user_id === USER_C);
  expect(notConfirmedYet.confirmed).toBe(false);
});
