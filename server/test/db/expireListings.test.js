// Un'offerta non può sopravvivere all'annuncio a cui si riferisce.
//
// Il caso reale segnalato dall'utente: aveva proposto uno scambio, il
// biglietto dall'altra parte è arrivato a data di partenza passata, e la sua
// proposta è rimasta lì "in attesa di risposta" — per sempre, senza che
// nessuno gli dicesse niente. L'annuncio scadeva, l'offerta no.
//
// Le due metà del comportamento, entrambe verificate qui contro il database
// vero: le offerte pendenti muoiono con l'annuncio, E chi le aveva proposte
// riceve un avviso invece di restare ad aspettare.
import test from 'node:test';
import assert from 'node:assert/strict';

import { motivoSkip, apri, chiudi, creaUtente, creaAnnuncio, creaOfferta, comeUtente } from './helpers.mjs';

const opzioni = { skip: motivoSkip };
const IERI = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const FRA_UN_MESE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

test('un treno già partito diventa scaduto, e la proposta pendente muore con lui', { ...opzioni }, async () => {
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore, departAt: IERI });
    const offerta = await creaOfferta(c, { proposerId: compratore, toListingId: annuncio, type: 'buy', amount: 20 });

    await comeUtente(c, venditore, () => c.query('select public.expire_my_stale_listings()'));

    const l = await c.query('select status from public.listings where id = $1', [annuncio]);
    const o = await c.query('select status from public.offers where id = $1', [offerta.id]);
    assert.equal(l.rows[0].status, 'expired');
    assert.equal(o.rows[0].status, 'expired');
  } finally {
    await chiudi(c);
  }
});

test('chi aveva proposto viene avvisato, non lasciato ad aspettare', { ...opzioni }, async () => {
  // È il pezzo che mancava: senza questa notifica il proponente vede la sua
  // offerta sparire dalle "in attesa" e non sa se sia stata rifiutata,
  // accettata o cosa.
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore, departAt: IERI });
    await creaOfferta(c, { proposerId: compratore, toListingId: annuncio, type: 'buy', amount: 20 });

    await comeUtente(c, venditore, () => c.query('select public.expire_my_stale_listings()'));

    const { rows } = await c.query(
      'select type from public.notifications where user_id = $1', [compratore],
    );
    assert.ok(
      rows.some((r) => r.type === 'offer_expired'),
      `il proponente doveva essere avvisato; notifiche trovate: ${JSON.stringify(rows)}`,
    );
  } finally {
    await chiudi(c);
  }
});

test('un annuncio ancora futuro non si tocca', { ...opzioni }, async () => {
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore, departAt: FRA_UN_MESE });
    const offerta = await creaOfferta(c, { proposerId: compratore, toListingId: annuncio, type: 'buy', amount: 20 });

    await comeUtente(c, venditore, () => c.query('select public.expire_my_stale_listings()'));

    const l = await c.query('select status from public.listings where id = $1', [annuncio]);
    const o = await c.query('select status from public.offers where id = $1', [offerta.id]);
    assert.equal(l.rows[0].status, 'active');
    assert.equal(o.rows[0].status, 'pending');
  } finally {
    await chiudi(c);
  }
});

test('scade solo la roba TUA: gli annunci degli altri non si toccano', { ...opzioni }, async () => {
  // expire_my_stale_listings filtra su auth.uid(). Se quel filtro saltasse,
  // un utente qualsiasi che apre l'app farebbe scadere gli annunci di tutti
  // gli altri — ed è il genere di cosa che con un client finto non si vede.
  const c = await apri();
  try {
    const mio = await creaUtente(c);
    const altro = await creaUtente(c);
    const suoAnnuncio = await creaAnnuncio(c, { userId: altro, departAt: IERI });

    await comeUtente(c, mio, () => c.query('select public.expire_my_stale_listings()'));

    const { rows } = await c.query('select status from public.listings where id = $1', [suoAnnuncio]);
    assert.equal(rows[0].status, 'active');
  } finally {
    await chiudi(c);
  }
});

test('un annuncio in pausa resta in pausa: non è scaduto, è messo da parte', { ...opzioni }, async () => {
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore, status: 'paused', departAt: IERI });

    await comeUtente(c, venditore, () => c.query('select public.expire_my_stale_listings()'));

    const { rows } = await c.query('select status from public.listings where id = $1', [annuncio]);
    assert.equal(rows[0].status, 'paused');
  } finally {
    await chiudi(c);
  }
});
