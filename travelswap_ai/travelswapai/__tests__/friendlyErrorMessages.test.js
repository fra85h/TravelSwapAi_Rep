// Bug trovato durante l'analisi "empatia/toni amichevoli": in 22 punti tra
// lib/chat.js, lib/chainChat.js, lib/offers.js e lib/db.js l'errore era
// `throw new Error(error.message || "messaggio amichevole")`. Siccome `||`
// dà priorità all'operando sinistro, un errore vero di Supabase/Postgres
// (quasi sempre "truthy") faceva arrivare all'utente il messaggio GREZZO del
// backend (spesso in inglese, a volte una RAISE EXCEPTION cruda tipo "Not
// allowed") invece del fallback amichevole in italiano scritto apposta — che
// restava di fatto codice morto. Fix: il messaggio amichevole è sempre
// quello mostrato; l'errore reale finisce solo in console.log per il
// debugging.
//
// Un campione rappresentativo (uno per file) basta: la logica è identica nei
// 22 punti (if (error) { console.log(...); throw new Error("<fallback>"); }).
const rawPgError = { message: "duplicate key value violates unique constraint \"offers_pkey\"" };

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: null, error: rawPgError }),
        }),
      }),
    }),
    rpc: async () => ({ data: null, error: rawPgError }),
  },
}));

test("lib/offers.js: acceptOffer mostra il messaggio amichevole, non l'errore Postgres grezzo", async () => {
  const { acceptOffer } = require("../lib/offers");
  await expect(acceptOffer("1")).rejects.toThrow("Impossibile accettare l'offerta");
  await expect(acceptOffer("1")).rejects.not.toThrow(rawPgError.message);
});

test("lib/chat.js: listMyChats mostra il messaggio amichevole, non l'errore Postgres grezzo", async () => {
  const { listMyChats } = require("../lib/chat");
  await expect(listMyChats()).rejects.toThrow("Impossibile caricare le chat");
  await expect(listMyChats()).rejects.not.toThrow(rawPgError.message);
});

test("lib/chainChat.js: listChainChatMessages mostra il messaggio amichevole, non l'errore Postgres grezzo", async () => {
  const { listChainChatMessages } = require("../lib/chainChat");
  await expect(listChainChatMessages("chain-1")).rejects.toThrow("Impossibile caricare i messaggi");
  await expect(listChainChatMessages("chain-1")).rejects.not.toThrow(rawPgError.message);
});

test("lib/db.js: getListingById mostra il messaggio amichevole, non l'errore Postgres grezzo", async () => {
  jest.resetModules();
  jest.doMock("../lib/supabase", () => ({
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: rawPgError }),
          }),
        }),
      }),
    },
  }));
  const { getListingById } = require("../lib/db");
  await expect(getListingById("listing-1")).rejects.toThrow("Impossibile caricare l'annuncio");
  await expect(getListingById("listing-1")).rejects.not.toThrow(rawPgError.message);
});
