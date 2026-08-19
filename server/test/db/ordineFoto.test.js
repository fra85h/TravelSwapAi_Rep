// Quale foto fa da copertina non può cambiare da una lettura all'altra.
//
// listing_images aveva solo chiave primaria e chiave esterna: niente
// impediva a due foto dello stesso annuncio di avere la stessa `position`, e
// in quel caso quale venisse prima lo decideva l'ordine in cui il database
// restituiva le righe. Su un annuncio con due foto — il massimo consentito —
// significa che la copertina poteva essere una volta il biglietto e una
// volta l'altra immagine, senza che nessuno avesse toccato niente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoSkip, apri, chiudi, creaUtente, creaAnnuncio, erroreDiIsolato } from "./helpers.mjs";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

const aggiungiFoto = (c, listingId, position, url = null) =>
  c.query(
    "insert into public.listing_images (listing_id, url, position) values ($1, $2, $3) returning id",
    [listingId, url ?? `https://cdn.example/${Math.random().toString(36).slice(2)}.jpg`, position],
  );

test("due foto non possono occupare lo stesso posto", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: io });
    await aggiungiFoto(c, annuncio, 0);

    const err = await erroreDiIsolato(c, () => aggiungiFoto(c, annuncio, 0));
    assert.match(String(err), /ux_listing_images_position|duplicate key/i);
  } finally {
    await chiudi(c);
  }
});

test("annunci diversi hanno ciascuno il proprio ordine", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const primo = await creaAnnuncio(c, { userId: io });
    const secondo = await creaAnnuncio(c, { userId: io });

    // Il vincolo è per annuncio, non globale: due annunci devono poter avere
    // entrambi la loro foto in posizione 0.
    assert.equal(await erroreDiIsolato(c, () => aggiungiFoto(c, primo, 0)), null);
    assert.equal(await erroreDiIsolato(c, () => aggiungiFoto(c, secondo, 0)), null);
  } finally {
    await chiudi(c);
  }
});

test("una foto senza indirizzo non entra", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: io });
    const err = await erroreDiIsolato(c, () =>
      c.query("insert into public.listing_images (listing_id, url, position) values ($1, null, 0)", [annuncio]),
    );
    assert.match(String(err), /null value|not-null/i);
  } finally {
    await chiudi(c);
  }
});

test("la rinumerazione scioglie gli scontri conservando l'ordine chiaro", opzioni, async () => {
  const c = await apri();
  try {
    // Si ricrea la situazione PRIMA della migration — vincolo tolto, due foto
    // sullo stesso posto — e si esegue la stessa rinumerazione che la
    // migration fa. È l'unico modo di provare quel pezzo: a schema applicato
    // il caso da riparare non si può più creare.
    const io = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: io });
    await c.query("alter table public.listing_images drop constraint ux_listing_images_position");

    const { rows: a } = await aggiungiFoto(c, annuncio, 0);
    const { rows: b } = await aggiungiFoto(c, annuncio, 0);

    await c.query(`
      WITH rinumerate AS (
        SELECT id, row_number() OVER (PARTITION BY listing_id ORDER BY position, id) - 1 AS nuova
          FROM public.listing_images
      )
      UPDATE public.listing_images i
         SET position = r.nuova
        FROM rinumerate r
       WHERE i.id = r.id AND i.position IS DISTINCT FROM r.nuova`);

    const { rows: dopo } = await c.query(
      "select id, position from public.listing_images where listing_id = $1 order by position",
      [annuncio],
    );
    assert.deepEqual(dopo.map((r) => r.position), [0, 1], "le posizioni devono diventare 0 e 1");
    // L'ordine si scioglie per id, quindi è lo stesso a ogni esecuzione:
    // deterministico, che è tutto ciò che serve.
    const attesi = [a[0].id, b[0].id].sort();
    assert.deepEqual(dopo.map((r) => r.id).sort(), attesi);

    // E dopo la riparazione il vincolo si può rimettere: è la prova che la
    // migration non fallisce su un database che il problema ce l'ha già.
    assert.equal(
      await erroreDiIsolato(c, () =>
        c.query("alter table public.listing_images add constraint ux_listing_images_position unique (listing_id, position)"),
      ),
      null,
    );
  } finally {
    await chiudi(c);
  }
});
