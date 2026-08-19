// Un annuncio deve dire se è una richiesta o un'offerta.
//
// `cerco_vendo` è la colonna da cui dipende tutto il resto: chi può fare
// un'offerta a chi, se c'è un bene reale in ballo, in quale direzione vanno i
// soldi. Era nullable, con un vincolo che su NULL non protegge niente — un
// CHECK confrontato con NULL vale NULL, cioè passa.
//
// Una riga così spariva senza far rumore: heuristicScore ricava il
// complementare da questo campo, e se non è né CERCO né VENDO il
// complementare è null, quindi l'annuncio non abbina MAI con nessuno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoSkip, apri, chiudi, creaUtente, erroreDiIsolato } from "./helpers.mjs";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

const inserisci = (c, userId, cercoVendo) =>
  c.query(
    `insert into public.listings
       (user_id, type, title, location, price, status, cerco_vendo, route_from, route_to, depart_at)
     values ($1, 'train'::listing_type, 'Prova', 'Roma → Milano', $2, 'paused'::listing_status, $3, 'Roma', 'Milano', '2027-05-10T08:00:00')
     returning id`,
    [userId, Math.round(Math.random() * 100000) / 100, cercoVendo],
  );

test("un annuncio senza cerco_vendo non entra", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const err = await erroreDiIsolato(c, () => inserisci(c, io, null));
    assert.match(String(err), /null value|not-null/i);
  } finally {
    await chiudi(c);
  }
});

test("i due valori validi entrano entrambi", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    // Il vincolo nuovo non deve stringere più di quanto serve: entrambe le
    // direzioni restano legittime.
    assert.equal(await erroreDiIsolato(c, () => inserisci(c, io, "VENDO")), null);
    assert.equal(await erroreDiIsolato(c, () => inserisci(c, io, "CERCO")), null);
  } finally {
    await chiudi(c);
  }
});

test("un valore inventato resta rifiutato", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    // Il CHECK preesistente c'era già e continua a valere: NOT NULL non lo
    // sostituisce, chiude solo il buco che si apriva su NULL.
    const err = await erroreDiIsolato(c, () => inserisci(c, io, "FORSE"));
    assert.match(String(err), /listings_cerco_vendo_check/);
  } finally {
    await chiudi(c);
  }
});

test("senza indicarlo, l'annuncio nasce VENDO per via del DEFAULT", opzioni, async () => {
  const c = await apri();
  try {
    // Sfumatura che vale la pena fissare: NOT NULL non obbliga il client a
    // nominare la colonna, perché il DEFAULT la riempie. Obbliga a non
    // scriverci dentro NULL di proposito, che è il caso che faceva danno.
    const io = await creaUtente(c);
    const { rows } = await c.query(
      `insert into public.listings
         (user_id, type, title, location, price, status, route_from, route_to, depart_at)
       values ($1, 'train'::listing_type, 'Prova', 'Roma → Milano', 12, 'paused'::listing_status, 'Roma', 'Milano', '2027-05-10T08:00:00')
       returning cerco_vendo`,
      [io],
    );
    assert.equal(rows[0].cerco_vendo, "VENDO");
  } finally {
    await chiudi(c);
  }
});
