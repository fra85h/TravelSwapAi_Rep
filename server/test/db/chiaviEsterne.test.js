// Tre colonne che puntano a un utente: adesso il database lo sa.
//
// chat_messages.sender_id, chain_messages.sender_id e matches.user_id sono
// uuid di utenti, ma nessun vincolo lo dichiarava. Ci si poteva scrivere
// dentro un identificativo inventato, e una DELETE a mano su auth.users
// lasciava righe che puntano a nessuno.
//
// Le regole di cancellazione sono diverse di proposito, e questi test
// difendono proprio quella differenza: un match è un suggerimento
// ricalcolabile e se ne va con l'utente; un messaggio è metà di una
// conversazione che appartiene anche all'altra persona, e cancellarlo
// distruggerebbe la sua cronologia — quindi la DELETE viene rifiutata, e chi
// la stava facendo viene indirizzato ad anonymize_account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoSkip, apri, chiudi, creaUtente, creaAnnuncio, erroreDiIsolato } from "./helpers.mjs";

const opzioni = motivoSkip ? { skip: motivoSkip } : {};

const INVENTATO = "00000000-0000-4000-8000-000000000000";

test("un mittente inventato non entra in chat_messages", opzioni, async () => {
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore });
    const { rows } = await c.query(
      `insert into public.offers (proposer_id, to_listing_id, type, amount)
       values ($1, $2, 'buy', 20) returning id`,
      [compratore, annuncio],
    );

    const err = await erroreDiIsolato(c, () =>
      c.query(
        "insert into public.chat_messages (offer_id, sender_id, body) values ($1, $2, 'ciao')",
        [rows[0].id, INVENTATO],
      ),
    );
    assert.match(String(err), /chat_messages_sender_id_fkey|violates foreign key/i);
  } finally {
    await chiudi(c);
  }
});

test("cancellare un utente con messaggi viene rifiutato, non eseguito a metà", opzioni, async () => {
  const c = await apri();
  try {
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore });
    const { rows } = await c.query(
      `insert into public.offers (proposer_id, to_listing_id, type, amount)
       values ($1, $2, 'buy', 20) returning id`,
      [compratore, annuncio],
    );
    await c.query(
      "insert into public.chat_messages (offer_id, sender_id, body) values ($1, $2, 'ciao')",
      [rows[0].id, compratore],
    );

    // È la scelta di fondo: meglio una cancellazione che fallisce con un
    // errore leggibile che una che riesce portandosi via metà della
    // conversazione dell'altra persona. La strada giusta è
    // anonymize_account, che il guscio lo lascia in piedi apposta.
    const err = await erroreDiIsolato(c, () =>
      c.query("delete from auth.users where id = $1", [compratore]),
    );
    assert.match(String(err), /chat_messages_sender_id_fkey|violates foreign key/i);

    const { rows: restano } = await c.query("select count(*)::int as n from public.chat_messages");
    assert.equal(restano[0].n, 1, "il messaggio deve essere ancora lì");
  } finally {
    await chiudi(c);
  }
});

test("i match invece se ne vanno con l'utente", opzioni, async () => {
  const c = await apri();
  try {
    const tizio = await creaUtente(c);
    const caio = await creaUtente(c);
    const suo = await creaAnnuncio(c, { userId: tizio });
    const altrui = await creaAnnuncio(c, { userId: caio });
    await c.query(
      `insert into public.matches (user_id, from_listing_id, to_listing_id, score)
       values ($1, $2, $3, 50)`,
      [tizio, suo, altrui],
    );

    // Un match è un suggerimento ricalcolabile, non una testimonianza:
    // sparito l'utente non ha più senso. anonymize_account già li cancella a
    // mano, la cascata fa la stessa cosa senza doversene ricordare.
    await c.query("delete from auth.users where id = $1", [tizio]);
    const { rows } = await c.query("select count(*)::int as n from public.matches where user_id = $1", [tizio]);
    assert.equal(rows[0].n, 0);
  } finally {
    await chiudi(c);
  }
});

test("il percorso dell'app non incontra nessuno di questi vincoli", opzioni, async () => {
  const c = await apri();
  try {
    // anonymize_account non cancella l'utente: svuota il profilo e lascia il
    // guscio, apposta perché la controparte non perda la cronologia. Se
    // questo test fallisce, i vincoli appena aggiunti hanno rotto la
    // cancellazione account vera — quella che usano le persone.
    const venditore = await creaUtente(c);
    const compratore = await creaUtente(c);
    const annuncio = await creaAnnuncio(c, { userId: venditore });
    const { rows: off } = await c.query(
      `insert into public.offers (proposer_id, to_listing_id, type, amount)
       values ($1, $2, 'buy', 20) returning id`,
      [compratore, annuncio],
    );
    await c.query(
      "insert into public.chat_messages (offer_id, sender_id, body) values ($1, $2, 'ciao')",
      [off[0].id, compratore],
    );
    await c.query("insert into public.profiles (id, full_name) values ($1, 'Tizio') on conflict (id) do nothing", [compratore]);

    const err = await erroreDiIsolato(c, () => c.query("select public.anonymize_account($1)", [compratore]));
    assert.equal(err, null, `anonymize_account deve continuare a funzionare: ${err}`);

    const { rows } = await c.query("select count(*)::int as n from public.chat_messages");
    assert.equal(rows[0].n, 1, "i messaggi restano: è il punto dell'anonimizzazione");
  } finally {
    await chiudi(c);
  }
});
