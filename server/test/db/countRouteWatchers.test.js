// count_route_watchers: quante persone seguono una tratta.
//
// È il dato che nessun altro ha — la domanda dichiarata — e vive dietro una
// RLS che dice "ognuno vede solo i propri avvisi". La funzione gira come
// proprietario e deve restituire SOLO un numero: se lasciasse passare una
// riga, chi pubblica saprebbe chi sta cercando cosa e a quale prezzo
// massimo. Quel confine si può provare solo su un Postgres vero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoSkip, apri, chiudi, creaUtente, comeUtente } from "./helpers.mjs";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

async function creaAvviso(c, { userId, type = "train", cercoVendo = "VENDO", from = null, to = null, location = null, maxPrice = null, active = true }) {
  const { rows } = await c.query(
    `insert into public.saved_searches (user_id, type, cerco_vendo, route_from, route_to, location, max_price, active)
     values ($1, $2::listing_type, $3, $4, $5, $6, $7, $8) returning id`,
    [userId, type, cercoVendo, from, to, location, maxPrice, active],
  );
  return rows[0].id;
}

const conta = async (c, args = {}) => {
  const { rows } = await c.query(
    "select public.count_route_watchers($1, $2, $3, $4, $5) as n",
    [args.type || "train", args.cercoVendo || "VENDO", args.from ?? null, args.to ?? null, args.location ?? null],
  );
  return rows[0].n;
};

test("conta gli avvisi altrui sulla tratta, non i propri", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const anna = await creaUtente(c);
    const bruno = await creaUtente(c);

    await creaAvviso(c, { userId: anna, from: "Roma", to: "Milano" });
    await creaAvviso(c, { userId: bruno, from: "Roma", to: "Milano" });
    // Il mio: sapere che sto aspettando me stesso non aiuta a scegliere un prezzo.
    await creaAvviso(c, { userId: io, from: "Roma", to: "Milano" });

    await comeUtente(c, io, async () => {
      assert.equal(await conta(c, { from: "Roma", to: "Milano" }), 2);
    });
  } finally {
    await chiudi(c);
  }
});

test("non restituisce righe, solo un numero", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const anna = await creaUtente(c);
    await creaAvviso(c, { userId: anna, from: "Roma", to: "Milano", maxPrice: 40 });

    await comeUtente(c, io, async () => {
      // La funzione dice "1"...
      assert.equal(await conta(c, { from: "Roma", to: "Milano" }), 1);
      // ...ma la tabella resta invisibile: né chi cerca, né a quale prezzo.
      const { rows } = await c.query("select * from public.saved_searches");
      assert.equal(rows.length, 0, "la RLS di saved_searches non deve cedere");
    });
  } finally {
    await chiudi(c);
  }
});

test("gli avvisi spenti non contano", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const anna = await creaUtente(c);
    await creaAvviso(c, { userId: anna, from: "Roma", to: "Milano", active: false });

    await comeUtente(c, io, async () => {
      assert.equal(await conta(c, { from: "Roma", to: "Milano" }), 0);
    });
  } finally {
    await chiudi(c);
  }
});

test("la tratta deve combaciare, e la stazione vale come la città", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const anna = await creaUtente(c);
    await creaAvviso(c, { userId: anna, from: "Roma", to: "Milano" });

    await comeUtente(c, io, async () => {
      // "Roma Termini" è come "Roma": è così che la gente scrive le stazioni.
      assert.equal(await conta(c, { from: "Roma Termini", to: "Milano Centrale" }), 1);
      // Tratta diversa: nessuno.
      assert.equal(await conta(c, { from: "Roma", to: "Napoli" }), 0);
      // Verso opposto: è un altro viaggio.
      assert.equal(await conta(c, { from: "Milano", to: "Roma" }), 0);
    });
  } finally {
    await chiudi(c);
  }
});

test("un avviso che non filtra sulla tratta segue tutto il tipo", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const anna = await creaUtente(c);
    // Campo vuoto = "non mi interessa da dove", come in cityMatches().
    await creaAvviso(c, { userId: anna, from: null, to: null });

    await comeUtente(c, io, async () => {
      assert.equal(await conta(c, { from: "Roma", to: "Milano" }), 1);
      assert.equal(await conta(c, { from: "Bari", to: "Torino" }), 1);
    });
  } finally {
    await chiudi(c);
  }
});

test("tipo e direzione separano i mercati", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const anna = await creaUtente(c);
    await creaAvviso(c, { userId: anna, type: "hotel", location: "Roma" });
    await creaAvviso(c, { userId: anna, type: "train", cercoVendo: "CERCO", from: "Roma", to: "Milano" });

    await comeUtente(c, io, async () => {
      // Chi segue gli hotel non c'entra con chi pubblica un treno.
      assert.equal(await conta(c, { type: "train", from: "Roma", to: "Milano" }), 0);
      assert.equal(await conta(c, { type: "hotel", location: "Roma" }), 1);
      // Chi cerca annunci CERCO non è in attesa del tuo VENDO.
      assert.equal(await conta(c, { type: "train", cercoVendo: "CERCO", from: "Roma", to: "Milano" }), 1);
    });
  } finally {
    await chiudi(c);
  }
});

test("un tipo che non esiste dà zero, non un errore", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    await comeUtente(c, io, async () => {
      // saved_searches.type è un enum: confrontarlo con un letterale che
      // l'enum non conosce farebbe 22P02 invece di restituire zero. Per
      // questo la funzione prende text e casta la colonna (vedi CLAUDE.md).
      assert.equal(await conta(c, { type: "aereo", from: "Roma", to: "Milano" }), 0);
    });
  } finally {
    await chiudi(c);
  }
});

test("chi non ha fatto l'accesso non può nemmeno chiamarla", opzioni, async () => {
  const c = await apri();
  try {
    await c.query("SAVEPOINT anon_prova");
    await c.query("SET LOCAL ROLE anon");
    await assert.rejects(
      () => conta(c, { from: "Roma", to: "Milano" }),
      /permission denied|non autorizzat/i,
      "una SECURITY DEFINER che legge dati altrui non va lasciata aperta a PUBLIC",
    );
    await c.query("ROLLBACK TO SAVEPOINT anon_prova");
    await c.query("RESET ROLE");
  } finally {
    await chiudi(c);
  }
});
