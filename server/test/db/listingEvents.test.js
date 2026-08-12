// La storia di prezzo e stato di un annuncio (listing_events).
//
// Nasce da un fatto che si stava perdendo ogni ora: il cron del prezzo
// dinamico sovrascrive listings.price a ogni giro, e updated_at cambia a
// ogni scrittura qualunque. Quindi "è stato in vetrina a 70€, poi a 55€,
// venduto a 40€ dopo cinque giorni" non era ricostruibile — ed è esattamente
// il dato che serve per stimare se un annuncio si venderà.
//
// È tutta roba che vive dentro Postgres: un trigger e una RLS. Nessun mock
// può vederla, per questo il test sta qui.
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoSkip, apri, chiudi, creaUtente, creaAnnuncio, comeUtente } from "./helpers.mjs";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

async function eventi(c, listingId) {
  const { rows } = await c.query(
    "select kind, price, status, dynamic, at from public.listing_events where listing_id = $1 order by id",
    [listingId],
  );
  return rows;
}

test("alla nascita di un annuncio viene registrato il punto di partenza", opzioni, async () => {
  const c = await apri();
  try {
    const u = await creaUtente(c);
    const l = await creaAnnuncio(c, { userId: u, price: 70 });

    const ev = await eventi(c, l);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].kind, "created");
    assert.equal(Number(ev[0].price), 70);
    assert.equal(ev[0].status, "active");
  } finally {
    await chiudi(c);
  }
});

test("ogni cambio di prezzo lascia una riga: è la serie che il decadimento cancellava", opzioni, async () => {
  const c = await apri();
  try {
    const u = await creaUtente(c);
    const l = await creaAnnuncio(c, { userId: u, price: 70 });

    // Due giri del cron del prezzo dinamico.
    await c.query("update public.listings set price = 55 where id = $1", [l]);
    await c.query("update public.listings set price = 40 where id = $1", [l]);

    const prezzi = (await eventi(c, l)).map((e) => Number(e.price));
    assert.deepEqual(prezzi, [70, 55, 40]);
  } finally {
    await chiudi(c);
  }
});

test("riscrivere lo STESSO prezzo non lascia niente", opzioni, async () => {
  const c = await apri();
  try {
    const u = await creaUtente(c);
    const l = await creaAnnuncio(c, { userId: u, price: 70 });

    // Il cron gira ogni ora su ogni annuncio: senza questo controllo la
    // tabella si riempirebbe di righe identiche, e la serie diventerebbe
    // illeggibile proprio per chi dovrà usarla.
    await c.query("update public.listings set price = 70 where id = $1", [l]);
    await c.query("update public.listings set title = 'altro titolo' where id = $1", [l]);

    assert.equal((await eventi(c, l)).length, 1);
  } finally {
    await chiudi(c);
  }
});

test("il cambio di stato data la fine dell'annuncio", opzioni, async () => {
  const c = await apri();
  try {
    const u = await creaUtente(c);
    const l = await creaAnnuncio(c, { userId: u, price: 50 });

    await c.query("update public.listings set status = 'sold'::listing_status where id = $1", [l]);

    const ev = await eventi(c, l);
    const fine = ev[ev.length - 1];
    assert.equal(fine.kind, "status");
    assert.equal(fine.status, "sold");
    // Il prezzo viaggia insieme allo stato: senza, per sapere a quanto è
    // stato venduto bisognerebbe risalire all'evento precedente.
    assert.equal(Number(fine.price), 50);
  } finally {
    await chiudi(c);
  }
});

test("prezzo e stato che cambiano insieme lasciano due righe distinte", opzioni, async () => {
  const c = await apri();
  try {
    const u = await creaUtente(c);
    const l = await creaAnnuncio(c, { userId: u, price: 50 });

    await c.query(
      "update public.listings set price = 45, status = 'paused'::listing_status where id = $1",
      [l],
    );

    const ev = await eventi(c, l);
    assert.deepEqual(ev.map((e) => e.kind), ["created", "price", "status"]);
  } finally {
    await chiudi(c);
  }
});

test("il prezzo dinamico è distinguibile da una scelta del venditore", opzioni, async () => {
  const c = await apri();
  try {
    const u = await creaUtente(c);
    const l = await creaAnnuncio(c, { userId: u, price: 100 });
    await c.query(
      "update public.listings set dynamic_pricing_enabled = true, price_floor = 40, list_price = 100, price = 90 where id = $1",
      [l],
    );

    const ev = await eventi(c, l);
    assert.equal(ev[0].dynamic, false, "alla nascita il dinamico era spento");
    assert.equal(ev[ev.length - 1].dynamic, true, "la discesa successiva è automatica");
  } finally {
    await chiudi(c);
  }
});

test("nessun utente può leggere la storia dei ribassi altrui", opzioni, async () => {
  const c = await apri();
  try {
    const u = await creaUtente(c);
    const l = await creaAnnuncio(c, { userId: u, price: 60 });
    await c.query("update public.listings set price = 45 where id = $1", [l]);

    // Nemmeno il proprietario: è materiale di analisi, non contenuto. Chi
    // compra, sapendo che un annuncio sta scendendo, aspetterebbe — e
    // cambierebbe il comportamento che stiamo misurando.
    await comeUtente(c, u, async () => {
      const { rows } = await c.query("select * from public.listing_events where listing_id = $1", [l]);
      assert.equal(rows.length, 0, "la RLS senza policy non lascia passare nessuno");
    });
  } finally {
    await chiudi(c);
  }
});

test("cancellare un annuncio per davvero porta via la sua storia", opzioni, async () => {
  const c = await apri();
  try {
    const u = await creaUtente(c);
    const l = await creaAnnuncio(c, { userId: u, price: 60 });
    await c.query("delete from public.listings where id = $1", [l]);

    // ON DELETE CASCADE: la storia di una riga che non esiste più non serve
    // a nessuno, e lasciarla orfana significherebbe tenere dati di un utente
    // che ha chiesto di sparire.
    assert.equal((await eventi(c, l)).length, 0);
  } finally {
    await chiudi(c);
  }
});
