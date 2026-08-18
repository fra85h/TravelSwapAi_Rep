// Un treno partito è partito: la scadenza va confrontata con l'orologio
// ITALIANO, non con l'ora di Greenwich.
//
// depart_at è un orario "da parete" (l'ora alla stazione) e l'app lo salva
// naive: la stringa "2026-08-18T09:00" arriva senza offset e Postgres, in
// sessione UTC, la registra come 09:00+00 — cioè le 11:00 italiane d'estate.
// Finché le funzioni confrontavano `depart_at < now()`, per tutta l'ampiezza
// dell'offset italiano (+2h d'estate, +1h d'inverno) un treno già partito
// risultava ancora in orario: restava 'active' e la sua offerta poteva
// essere ACCETTATA, chiudendo uno scambio su un biglietto ormai inutile.
//
// I test qui sotto costruiscono le date come fa l'app — orario di parete
// italiano riletto come UTC — e passano solo con _wall_now(). Con il vecchio
// `now()` fallirebbero in qualunque momento dell'anno, perché l'Italia non è
// mai a offset zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoSkip, apri, chiudi, creaUtente, creaAnnuncio, creaOfferta, comeUtente } from "./helpers.mjs";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

/**
 * L'istante che l'app scriverebbe per un treno in partenza fra `minuti`
 * minuti di orologio italiano (negativo = già partito). È la traduzione in
 * SQL di quello che fa CreateListingScreen: prende l'ora di parete e la
 * manda senza offset.
 */
const oraDiParete = (minuti) =>
  `((now() AT TIME ZONE 'Europe/Rome') + interval '${minuti} minutes') AT TIME ZONE 'UTC'`;

async function annuncioTreno(c, userId, minuti, status = "active") {
  const id = await creaAnnuncio(c, { userId, status });
  await c.query(`update public.listings set depart_at = ${oraDiParete(minuti)} where id = $1`, [id]);
  return id;
}

const statoDi = async (c, id) => {
  const { rows } = await c.query("select status::text as s from public.listings where id = $1", [id]);
  return rows[0].s;
};

test("un treno partito mezz'ora fa risulta scaduto", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const partito = await annuncioTreno(c, io, -30);

    await comeUtente(c, io, async () => {
      await c.query("select public.expire_my_stale_listings()");
    });

    assert.equal(await statoDi(c, partito), "expired");
  } finally {
    await chiudi(c);
  }
});

test("un treno che parte fra mezz'ora resta attivo", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    // Il controllo speculare: senza questo, una funzione che scade TUTTO
    // passerebbe il test precedente senza aver capito niente.
    const inOrario = await annuncioTreno(c, io, +30);

    await comeUtente(c, io, async () => {
      await c.query("select public.expire_my_stale_listings()");
    });

    assert.equal(await statoDi(c, inOrario), "active");
  } finally {
    await chiudi(c);
  }
});

test("l'offerta su un treno già partito non si può accettare", opzioni, async () => {
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const partito = await annuncioTreno(c, venditore, -30);
    const offerta = await creaOfferta(c, {
      proposerId: compratore,
      toListingId: partito,
      type: "buy",
      amount: 20,
    });

    const esito = await comeUtente(c, venditore, async () => {
      const { rows } = await c.query("select (public.accept_offer_any($1)).status::text as s", [String(offerta.id)]);
      return rows[0].s;
    });

    // Non "accepted": il viaggio è passato, quindi la proposta muore e
    // l'annuncio con lei. Prima di _wall_now() questa accettazione andava a
    // buon fine e i due si ritrovavano una transazione su un treno partito.
    assert.equal(esito, "expired");
    assert.equal(await statoDi(c, partito), "expired");
  } finally {
    await chiudi(c);
  }
});

test("l'offerta su un treno in orario si accetta normalmente", opzioni, async () => {
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const inOrario = await annuncioTreno(c, venditore, +120);
    const offerta = await creaOfferta(c, {
      proposerId: compratore,
      toListingId: inOrario,
      type: "buy",
      amount: 20,
    });

    const esito = await comeUtente(c, venditore, async () => {
      const { rows } = await c.query("select (public.accept_offer_any($1)).status::text as s", [String(offerta.id)]);
      return rows[0].s;
    });

    assert.equal(esito, "accepted");
  } finally {
    await chiudi(c);
  }
});

test("_wall_now() è avanti a now() esattamente dell'offset italiano", opzioni, async () => {
  const c = await apri();
  try {
    const { rows } = await c.query(`
      select extract(epoch from (public._wall_now() - now()))::int as scarto,
             extract(epoch from utc_offset)::int as offset_italia
        from pg_timezone_names where name = 'Europe/Rome'
    `);
    // Un solo modo per sbagliare questo test: cambiare _wall_now() in
    // qualcosa che non sia l'ora italiana. Vale sia con l'ora legale (7200)
    // sia con quella solare (3600), senza doverne scegliere una.
    assert.equal(rows[0].scarto, rows[0].offset_italia);
    assert.ok([3600, 7200].includes(rows[0].scarto), `offset inatteso: ${rows[0].scarto}`);
  } finally {
    await chiudi(c);
  }
});
