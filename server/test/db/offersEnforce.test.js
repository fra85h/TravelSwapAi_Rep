// Le regole di modello, provate dove sono davvero applicate: nel database.
//
// La regola in una riga: un'offerta (acquisto O scambio) ha senso SOLO
// verso un VENDO, e uno scambio richiede un biglietto su ENTRAMBI i lati.
// Un CERCO è una richiesta, non un bene: non si compra e non si dà in
// cambio.
//
// L'app nasconde già i pulsanti che non hanno senso, ma il trigger
// `before_insert_offers_enforce` è la difesa da QUALUNQUE client — non solo
// dall'app ufficiale. Ed è codice che nessun mock ha mai eseguito: è stato
// rotto due volte in produzione senza che la CI se ne accorgesse.
import test from 'node:test';
import assert from 'node:assert/strict';

import { motivoSkip, apri, chiudi, creaUtente, creaAnnuncio, creaOfferta, comeUtente, erroreDi } from './helpers.mjs';

const opzioni = { skip: motivoSkip };

test('acquisto verso un VENDO attivo: passa', { ...opzioni }, async () => {
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore, cercoVendo: 'VENDO' });

    const offerta = await creaOfferta(c, { proposerId: compratore, toListingId: annuncio, type: 'buy', amount: 40 });
    assert.ok(offerta.id);
    assert.equal(offerta.status, 'pending');
  } finally {
    await chiudi(c);
  }
});

test('offerta verso un CERCO: rifiutata dal database', { ...opzioni }, async () => {
  const c = await apri();
  try {
    const cercatore = await creaUtente(c);
    const tizio = await creaUtente(c);
    const richiesta = await creaAnnuncio(c, { userId: cercatore, cercoVendo: 'CERCO' });

    const err = await erroreDi(creaOfferta(c, { proposerId: tizio, toListingId: richiesta, type: 'buy', amount: 10 }));
    assert.match(String(err), /CERCO/i);
  } finally {
    await chiudi(c);
  }
});

test('scambio che OFFRE un CERCO: rifiutato', { ...opzioni }, async () => {
  // Il lato meno ovvio della regola: il target è un VENDO regolare, ma chi
  // propone non ha niente da dare — sta offrendo una sua richiesta.
  const c = await apri();
  try {
    const a = await creaUtente(c);
    const b = await creaUtente(c);
    const bersaglio = await creaAnnuncio(c, { userId: a, cercoVendo: 'VENDO' });
    const miaRichiesta = await creaAnnuncio(c, { userId: b, cercoVendo: 'CERCO' });

    const err = await erroreDi(creaOfferta(c, {
      proposerId: b, toListingId: bersaglio, fromListingId: miaRichiesta, type: 'swap',
    }));
    assert.match(String(err), /VENDO/i);
  } finally {
    await chiudi(c);
  }
});

test('scambio fra due VENDO: passa', { ...opzioni }, async () => {
  const c = await apri();
  try {
    const a = await creaUtente(c);
    const b = await creaUtente(c);
    const suo = await creaAnnuncio(c, { userId: a, cercoVendo: 'VENDO' });
    const mio = await creaAnnuncio(c, { userId: b, cercoVendo: 'VENDO' });

    const offerta = await creaOfferta(c, { proposerId: b, toListingId: suo, fromListingId: mio, type: 'swap' });
    assert.ok(offerta.id);
  } finally {
    await chiudi(c);
  }
});

test('non si propone verso un annuncio in pausa', { ...opzioni }, async () => {
  const c = await apri();
  try {
    const a = await creaUtente(c);
    const b = await creaUtente(c);
    const fermo = await creaAnnuncio(c, { userId: a, status: 'paused' });

    const err = await erroreDi(creaOfferta(c, { proposerId: b, toListingId: fermo, type: 'buy', amount: 10 }));
    assert.match(String(err), /attivi/i);
  } finally {
    await chiudi(c);
  }
});

test('due proposte di scambio dallo stesso annuncio lo tolgono dalla piazza, la terza è rifiutata', { ...opzioni }, async () => {
  // Comportamento reale, verificato qui e non dedotto: dopo DUE proposte di
  // scambio uscenti, `recompute_listing_pending_state` porta l'annuncio in
  // 'pending' — non è più in vetrina, e questo basta a fermare la terza
  // proposta prima ancora che il limite esplicito del trigger entri in
  // gioco. Le due difese si sovrappongono di proposito.
  //
  // Il passaggio in 'pending' è anche ciò che esercita `_norm(o.status::text)`
  // su una colonna ENUM: senza il cast Postgres risponde "function
  // _norm(offer_status) does not exist" e la proposta muore lì. È successo
  // in produzione, ed è stato reintrodotto una seconda volta riscrivendo la
  // funzione da una versione vecchia.
  const c = await apri();
  try {
    const io = await creaUtente(c);
    const altri = await creaUtente(c);
    const mio = await creaAnnuncio(c, { userId: io, cercoVendo: 'VENDO' });
    const uno = await creaAnnuncio(c, { userId: altri, cercoVendo: 'VENDO', title: 'Uno' });
    const due = await creaAnnuncio(c, { userId: altri, cercoVendo: 'VENDO', title: 'Due' });
    const tre = await creaAnnuncio(c, { userId: altri, cercoVendo: 'VENDO', title: 'Tre' });

    await creaOfferta(c, { proposerId: io, toListingId: uno, fromListingId: mio, type: 'swap' });
    const dopoUna = await c.query('select status from public.listings where id = $1', [mio]);
    assert.equal(dopoUna.rows[0].status, 'active', 'con una sola proposta l\'annuncio resta in vetrina');

    await creaOfferta(c, { proposerId: io, toListingId: due, fromListingId: mio, type: 'swap' });
    const dopoDue = await c.query('select status from public.listings where id = $1', [mio]);
    assert.equal(dopoDue.rows[0].status, 'pending');

    const err = await erroreDi(creaOfferta(c, { proposerId: io, toListingId: tre, fromListingId: mio, type: 'swap' }));
    assert.match(String(err), /attiva/i, `atteso il rifiuto della terza, ricevuto: ${err}`);
    assert.doesNotMatch(String(err), /does not exist/i, 'il cast ::text su offers.status è tornato a mancare');
  } finally {
    await chiudi(c);
  }
});

test('accettare un\'offerta: il cast mancante su offers.status rompeva ESATTAMENTE questo', { ...opzioni }, async () => {
  // Il guasto storico in una riga: `_norm(offers.status)` senza `::text`
  // faceva fallire OGNI accettazione, rifiuto e annullamento in produzione,
  // con la CI verde perché nessun test eseguiva plpgsql.
  //
  // accept_offer_any gira come il proprietario dell'annuncio, quindi il
  // test lo chiama impersonandolo davvero: è SECURITY DEFINER ma legge
  // auth.uid() per sapere chi sta accettando.
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore, cercoVendo: 'VENDO' });
    const offerta = await creaOfferta(c, { proposerId: compratore, toListingId: annuncio, type: 'buy', amount: 25 });

    await comeUtente(c, venditore, () => c.query('select public.accept_offer_any($1)', [String(offerta.id)]));

    const { rows } = await c.query('select status from public.offers where id = $1', [offerta.id]);
    assert.equal(rows[0].status, 'accepted');
  } finally {
    await chiudi(c);
  }
});

test('accettare un\'offerta avvisa chi l\'aveva proposta', { ...opzioni }, async () => {
  // La notifica al proponente nasce da notify_on_offer sul cambio di stato,
  // e il tipo che inserisce deve essere fra quelli ammessi dal vincolo di
  // notifications: se non lo è, a fallire non è l'avviso — è
  // l'accettazione, e l'offerta resta appesa senza che nessuno capisca.
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore, cercoVendo: 'VENDO' });
    const offerta = await creaOfferta(c, { proposerId: compratore, toListingId: annuncio, type: 'buy', amount: 25 });

    await comeUtente(c, venditore, () => c.query('select public.accept_offer_any($1)', [String(offerta.id)]));

    const { rows } = await c.query(
      'select type from public.notifications where user_id = $1 order by created_at', [compratore],
    );
    assert.ok(rows.some((r) => r.type === 'offer_accepted'), `notifiche ricevute: ${JSON.stringify(rows)}`);
  } finally {
    await chiudi(c);
  }
});

test('la notifica al proprietario nasce insieme all\'offerta', { ...opzioni }, async () => {
  // L'altro guasto arrivato in produzione con la CI verde: notify_on_offer
  // è un trigger AFTER INSERT, quindi se il tipo di notifica che inserisce
  // non è fra quelli ammessi dal vincolo, a fallire non è la notifica —
  // è l'intera offerta. L'utente vede "errore" e non capisce perché.
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore, title: 'Roma-Milano andata' });

    const offerta = await creaOfferta(c, { proposerId: compratore, toListingId: annuncio, type: 'buy', amount: 30 });

    const { rows } = await c.query(
      "select type, data from public.notifications where user_id = $1", [venditore],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'offer_received');
    assert.equal(String(rows[0].data.offerId), String(offerta.id));
  } finally {
    await chiudi(c);
  }
});

test('nessuna notifica se ti fai un\'offerta da solo', { ...opzioni }, async () => {
  const c = await apri();
  try {
    const tizio = await creaUtente(c);
    const suo = await creaAnnuncio(c, { userId: tizio, title: 'Il mio' });
    const altroSuo = await creaAnnuncio(c, { userId: tizio, title: 'Anche mio' });

    await creaOfferta(c, { proposerId: tizio, toListingId: suo, fromListingId: altroSuo, type: 'swap' });

    const { rows } = await c.query("select count(*)::int n from public.notifications where user_id = $1", [tizio]);
    assert.equal(rows[0].n, 0);
  } finally {
    await chiudi(c);
  }
});
