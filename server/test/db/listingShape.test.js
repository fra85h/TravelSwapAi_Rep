// Un annuncio deve avere i campi del suo tipo, e solo quelli.
//
// L'app scrive direttamente su PostgREST: fra la schermata e la tabella non
// c'è nessun livello server, quindi finora l'unica validazione di forma era
// quella del client. Questi test provano il backstop dal lato da cui il
// client non passa: un INSERT diretto, come lo farebbe una versione vecchia
// dell'app rimasta su un telefono o uno script con la chiave anon.
//
// La riga più pericolosa è il treno senza depart_at: expire_my_stale_listings
// lo salta (la condizione vuole `depart_at is not null`), quindi resta
// acquistabile per sempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoSkip, apri, chiudi, creaUtente, creaAnnuncio, erroreDiIsolato } from "./helpers.mjs";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

/** Un INSERT grezzo: nessun aiuto dai fixture, esattamente come lo farebbe un client qualunque. */
function inserisci(c, userId, campi = {}) {
  const riga = {
    user_id: userId,
    type: "train",
    title: "Annuncio di prova",
    location: "Roma → Milano",
    price: Math.round(Math.random() * 100000) / 100,
    status: "active",
    cerco_vendo: "VENDO",
    route_from: "Roma",
    route_to: "Milano",
    depart_at: "2027-05-10T08:00:00",
    arrive_at: null,
    check_in: null,
    check_out: null,
    ...campi,
  };
  const colonne = Object.keys(riga);
  const segnaposto = colonne.map((k, i) => {
    if (k === "type") return `$${i + 1}::listing_type`;
    if (k === "status") return `$${i + 1}::listing_status`;
    return `$${i + 1}`;
  });
  return c.query(
    `insert into public.listings (${colonne.join(", ")}) values (${segnaposto.join(", ")}) returning id`,
    colonne.map((k) => riga[k]),
  );
}

test("un treno non può avere le date di un albergo", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const err = await erroreDiIsolato(c, () => inserisci(c, io, { check_in: "2027-05-10" }));
    assert.match(String(err), /chk_listings_train_has_no_hotel_fields/);
  } finally {
    await chiudi(c);
  }
});

test("un hotel non può avere tratta né orario di partenza", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const hotel = {
      type: "hotel",
      location: "Roma",
      check_in: "2027-05-10",
      check_out: "2027-05-12",
      route_from: null,
      route_to: null,
      depart_at: null,
    };

    // Questo è il caso che ho verificato entrare prima del vincolo: un hotel
    // con depart_at porta due date che si contraddicono nelle stesse colonne
    // da cui il matching ricava la prossimità.
    const conPartenza = await erroreDiIsolato(c, () => inserisci(c, io, { ...hotel, depart_at: "2027-05-10T08:00:00" }));
    assert.match(String(conPartenza), /chk_listings_hotel_has_no_train_fields/);

    const conTratta = await erroreDiIsolato(c, () => inserisci(c, io, { ...hotel, route_from: "Roma" }));
    assert.match(String(conTratta), /chk_listings_hotel_has_no_train_fields/);

    // Ma un hotel fatto bene entra.
    assert.equal(await erroreDiIsolato(c, () => inserisci(c, io, hotel)), null);
  } finally {
    await chiudi(c);
  }
});

test("un treno pubblico senza partenza non entra", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const err = await erroreDiIsolato(c, () => inserisci(c, io, { depart_at: null }));
    assert.match(String(err), /chk_listings_live_train_complete/);
  } finally {
    await chiudi(c);
  }
});

test("un treno pubblico senza tratta non entra, nemmeno con spazi", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    assert.match(String(await erroreDiIsolato(c, () => inserisci(c, io, { route_from: null }))), /chk_listings_live_train_complete/);
    // Una stringa di spazi è vuota quanto NULL, e passava dai controlli del
    // client che fanno .trim(): il vincolo deve vederla allo stesso modo.
    assert.match(String(await erroreDiIsolato(c, () => inserisci(c, io, { route_to: "   " }))), /chk_listings_live_train_complete/);
  } finally {
    await chiudi(c);
  }
});

test("un hotel pubblico senza check-out non entra", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const err = await erroreDiIsolato(c, () => inserisci(c, io, {
      type: "hotel", location: "Roma", route_from: null, route_to: null,
      depart_at: null, check_in: "2027-05-10", check_out: null,
    }));
    assert.match(String(err), /chk_listings_live_hotel_complete/);
  } finally {
    await chiudi(c);
  }
});

test("una bozza in pausa può restare incompleta", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    // È la via d'uscita, e serve: l'importazione da Messenger crea l'annuncio
    // in pausa e lo completa dopo, e un annuncio già online che risultasse
    // incompleto deve poter essere messo in pausa invece di restare
    // inchiodato dove sta.
    assert.equal(await erroreDiIsolato(c, () => inserisci(c, io, { status: "paused", depart_at: null, route_from: null })), null);
    assert.equal(await erroreDiIsolato(c, () => inserisci(c, io, { status: "expired", depart_at: null })), null);
  } finally {
    await chiudi(c);
  }
});

test("una bozza incompleta non può diventare pubblica", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const { rows } = await inserisci(c, io, { status: "paused", depart_at: null });
    const err = await erroreDiIsolato(c, () =>
      c.query("update public.listings set status = 'active' where id = $1", [rows[0].id]),
    );
    assert.match(String(err), /chk_listings_live_train_complete/);
  } finally {
    await chiudi(c);
  }
});

test("gli annunci normali dei test continuano a entrare", opzioni, async () => {
  const c = await apri();
  try {
    const io = await creaUtente(c);
    // Se questo test fallisce, il vincolo è più stretto di quello che l'app
    // produce davvero: il fixture nasce dagli stessi campi delle schermate.
    assert.ok(await creaAnnuncio(c, { userId: io }));
    assert.ok(await creaAnnuncio(c, { userId: io, type: "hotel" }));
    assert.ok(await creaAnnuncio(c, { userId: io, cercoVendo: "CERCO" }));
  } finally {
    await chiudi(c);
  }
});
