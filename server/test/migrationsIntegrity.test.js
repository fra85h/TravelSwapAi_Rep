// Invarianti delle funzioni SQL riscritte più volte.
//
// La CI non ha un database, quindi qui non si esegue SQL: si controlla che
// l'ULTIMA versione di ogni funzione (per ordine di nome file, cioè di
// timestamp) contenga ancora le correzioni introdotte nelle versioni
// precedenti. È la regressione documentata in CLAUDE.md:
// before_insert_offers_enforce era stato corretto in 20260711160004, poi
// 20260717120000 l'ha riscritta ripartendo dalla versione vecchia e ha perso
// il cast `_norm(o.status::text)`, rompendo TUTTE le proposte di scambio in
// produzione.
//
// Ogni assert qui vale un giro di produzione perso: se fallisce, quasi
// sempre è perché una nuova migration è ripartita da una base sbagliata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations',
);

const FILES = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/** Toglie i commenti `--`: i file di fix citano il codice rotto per spiegarlo. */
function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

/** Corpo dell'ultima definizione di una funzione, cercando dal file più recente. */
function latestDefinitionOf(fnName) {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fnName}\\s*\\(`,
    'i',
  );
  for (const file of [...FILES].reverse()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    const m = sql.match(re);
    if (!m) continue;
    // dal punto di definizione fino alla fine del corpo dollar-quoted
    const from = sql.slice(m.index);
    const end = from.indexOf('$$;');
    return { file, body: end >= 0 ? from.slice(0, end + 3) : from };
  }
  return null;
}

test('ogni funzione attesa esiste in almeno una migration', () => {
  for (const fn of [
    'accept_offer_any', 'confirm_exchange_any', 'enforce_active_listing_cap',
    'before_insert_listings_block_duplicate', 'update_listing_trust_score',
    'sync_pnr_fingerprint', 'replace_matches_for_sources',
  ]) {
    assert.ok(latestDefinitionOf(fn), `funzione mai definita: ${fn}`);
  }
});

test('le colonne enum non vengono mai passate a _norm senza cast ::text', () => {
  // "function _norm(offer_status) does not exist": non un errore silenzioso,
  // ma blocca la query. Il cast va messo sempre.
  //
  // Si guarda SOLO l'ultima versione di ogni funzione: le migration superate
  // contengono per forza il codice sbagliato (è la loro storia), e i file di
  // fix ne citano il testo nei commenti per spiegare cosa era rotto. Un test
  // che leggesse tutto segnalerebbe quelli invece dei bug veri.
  const FUNZIONI_SU_ENUM = [
    'after_update_offers_propagate', 'before_insert_offers_enforce',
    'expire_old_accepted_offers', 'recompute_listing_pending_state',
    'accept_offer_any', 'confirm_exchange_any',
  ];
  for (const fn of FUNZIONI_SU_ENUM) {
    const def = latestDefinitionOf(fn);
    if (!def) continue;
    const codice = stripComments(def.body);
    for (const m of codice.matchAll(/_norm\(\s*([a-z_]+\.status)\s*\)/gi)) {
      assert.fail(`${fn} (${def.file}): _norm(${m[1]}) senza ::text`);
    }
  }
});

test('accept_offer_any e confirm_exchange_any bloccano gli annunci in ordine stabile', () => {
  // Senza ORDER BY, due transazioni possono prendere i lock sugli stessi due
  // annunci in sequenza opposta e finire in deadlock. L'ordine dev'essere lo
  // stesso in ENTRAMBE le funzioni, non solo in una.
  for (const fn of ['accept_offer_any', 'confirm_exchange_any']) {
    const { file, body } = latestDefinitionOf(fn);
    const locks = [...body.matchAll(/order\s+by\s+l\.id\s+for\s+update/gi)];
    assert.ok(locks.length >= 1, `${fn} (${file}): manca "order by l.id for update"`);
    // nessun FOR UPDATE su listings senza un ordine davanti
    const bare = [...body.matchAll(/from\s+public\.listings\s+l\b[\s\S]{0,600}?for\s+update/gi)]
      .filter((m) => !/order\s+by/i.test(m[0]));
    assert.equal(bare.length, 0, `${fn} (${file}): FOR UPDATE su listings senza ORDER BY`);
  }
});

test('accept_offer_any declina le proposte pending su ENTRAMBI gli annunci di uno scambio', () => {
  // Bug reale trovato scrivendo il test funzionale sulla checklist manuale
  // (Parte 3): per uno scambio, from_listing_id (l'annuncio ceduto in
  // cambio) viene riservato esattamente come to_listing_id, ma il declino
  // delle altre proposte pending copriva solo to_listing_id — un terzo
  // utente con un'offerta pending su from_listing_id restava "in sospeso"
  // a tempo indeterminato invece di ricevere subito la notifica di rifiuto.
  const { file, body } = latestDefinitionOf('accept_offer_any');
  const declineBlock = body.match(/update\s+public\.offers\s+set\s+status\s*=\s*'declined'[\s\S]{0,400}?status\s*=\s*'pending'/i);
  assert.ok(declineBlock, `${file}: non trovo il blocco di declino delle proposte pending`);
  assert.match(declineBlock[0], /from_listing_id/i,
    `${file}: il declino copre solo to_listing_id, non from_listing_id`);
});

test('i controlli "conta-poi-inserisci" prendono il lock sull\'utente', () => {
  // Senza advisory lock due richieste concorrenti dello stesso utente leggono
  // entrambe una situazione ancora lecita e passano entrambe: si superano i
  // 10 annunci attivi, o nasce il duplicato che il trigger deve impedire.
  for (const fn of ['enforce_active_listing_cap', 'before_insert_listings_block_duplicate']) {
    const { file, body } = latestDefinitionOf(fn);
    assert.match(
      body, /pg_advisory_xact_lock\(\s*915001\s*,\s*hashtext\(/i,
      `${fn} (${file}): manca il lock per utente`,
    );
  }
});

test('le due chiavi di advisory lock coincidono, altrimenti non si serializzano', () => {
  const keys = ['enforce_active_listing_cap', 'before_insert_listings_block_duplicate']
    .map((fn) => latestDefinitionOf(fn).body.match(/pg_advisory_xact_lock\(([^)]*\))/i)[1]);
  assert.equal(keys[0], keys[1], 'chiavi diverse: i due trigger non si escludono a vicenda');
});

test('i trigger di sistema saltano gli annunci in stato terminale', () => {
  // before_update_listings_lock_terminal rifiuta QUALUNQUE modifica a un
  // annuncio concluso: un trigger di sistema che ci scrive sopra fa esplodere
  // l'operazione che lo ha innescato (l'INSERT su trust_audit, la DELETE su
  // listing_secrets).
  for (const fn of ['update_listing_trust_score', 'sync_pnr_fingerprint']) {
    const { file, body } = latestDefinitionOf(fn);
    assert.match(
      body, /'sold'\s*,\s*'swapped'\s*,\s*'exchanged'\s*,\s*'traded'/i,
      `${fn} (${file}): non salta gli stati terminali`,
    );
  }
});

test('update_listing_trust_score apre e richiude la finestra di sincronizzazione', () => {
  // La colonna è bloccata da before_update_listings_lock_columns: senza la
  // finestra il valore torna indietro e il punteggio resta congelato (bug
  // reale, corretto in 20260724120000).
  const { file, body } = latestDefinitionOf('update_listing_trust_score');
  assert.match(body, /set_config\('app\.sync_trust_score',\s*'on',\s*true\)/i, file);
  assert.match(body, /set_config\('app\.sync_trust_score',\s*'off',\s*true\)/i, file);
});

test('update_listing_trust_score non cancella mai un punteggio precedente valido', () => {
  // Bug reale corretto in 20260731150000: la funzione faceva SEMPRE
  // "trust_score = NEW.trust_score" (verifica riuscita O fallita). Un
  // ricontrollo fallito su un annuncio già verificato (NEW.trust_score
  // NULL) scriveva NULL sopra un punteggio buono, facendo sparire
  // l'affidabilità da un annuncio invariato. La UPDATE che propaga il
  // nuovo punteggio deve stare dentro un ramo che verifica esplicitamente
  // NEW.trust_score IS NOT NULL.
  const { file, body } = latestDefinitionOf('update_listing_trust_score');
  const guarded = body.match(/IF\s+NEW\.trust_score\s+IS\s+NOT\s+NULL\s+THEN([\s\S]*?)END\s+IF;/i);
  assert.ok(guarded, `${file}: manca il guard "IF NEW.trust_score IS NOT NULL"`);
  assert.match(guarded[1], /SET\s+trust_score\s*=\s*NEW\.trust_score/i,
    `${file}: la propagazione del punteggio non è dentro il guard`);
});

test('replace_matches_for_sources fa DELETE e INSERT nella stessa funzione', () => {
  // È tutto il punto della RPC: separarli in due chiamate PostgREST rimette
  // il ricalcolo dei match in due transazioni distinte.
  const { file, body } = latestDefinitionOf('replace_matches_for_sources');
  assert.match(body, /delete\s+from\s+public\.matches/i, file);
  assert.match(body, /insert\s+into\s+public\.matches/i, file);
  assert.match(body, /on\s+conflict\s*\(\s*from_listing_id\s*,\s*to_listing_id\s*\)/i, file);
});

test('release_my_stale_reservations blocca la riga prima di scriverla', () => {
  // Bug reale trovato in audit: senza SELECT ... FOR UPDATE, una
  // finalizzazione concorrente (confirm_exchange_any) può committare
  // 'finalized' dopo che questo cursore ha già preso lo snapshot, e la
  // UPDATE finale sovrascriverebbe comunque a 'cancelled' un'offerta appena
  // conclusa per davvero.
  const { file, body } = latestDefinitionOf('release_my_stale_reservations');
  assert.match(body, /select\s+\*\s+into\s+v_offer\s+from\s+public\.offers\s+where\s+id\s*=\s*r\.id\s+for\s+update/i,
    `${file}: manca il lock sulla riga prima della scrittura`);
  assert.match(body, /if\s+v_offer\.status\s*<>\s*'accepted'\s+then\s+continue/i,
    `${file}: manca il ricontrollo dello stato dopo il lock`);
});

test('confirm_chain_participant blocca i 3 annunci prima di riservarli', () => {
  // Stesso bug di accept_offer_any prima della correzione in 20260726120000,
  // mai propagato qui: senza lock, un'offerta 1:1 su uno dei 3 annunci della
  // catena può essere accettata nello stesso istante in cui la catena
  // raggiunge la terza conferma, generando due transazioni in conflitto sullo
  // stesso biglietto fisico.
  const { file, body } = latestDefinitionOf('confirm_chain_participant');
  assert.match(body, /order\s+by\s+l\.id\s+for\s+update/i,
    `${file}: manca il lock ordinato sugli annunci della catena`);
  assert.match(body, /set\s+status\s*=\s*'reserved'\s*\n?\s*where\s+id\s*=\s*v_participant\.give_listing_id\s+and\s+status\s*=\s*'active'/i,
    `${file}: la UPDATE di riserva non ricontrolla lo stato`);
});

test('il trigger anti-duplicato copre solo le riattivazioni volontarie', () => {
  // Estenderlo a OGNI ritorno ad 'active' bloccherebbe le transizioni di
  // sistema (confirm_exchange_any che libera il lato non concluso,
  // release_my_stale_reservations), lasciando annunci incastrati.
  const { file, body } = latestDefinitionOf('before_insert_listings_block_duplicate');
  assert.match(
    body, /tg_op\s*=\s*'INSERT'\s+or\s+old\.status::text\s+in\s*\(\s*'paused'\s*,\s*'expired'\s*\)/i,
    `${file}: transizioni coperte diverse da quelle del tetto agli attivi`,
  );
});

test('notify_on_offer incoraggia a riprovare quando una proposta è rifiutata', () => {
  // Sia acquisto che scambio passano dallo stesso ramo 'declined': il body
  // non deve limitarsi ad annunciare il rifiuto, ma invitare a riprovare.
  const { file, body } = latestDefinitionOf('notify_on_offer');
  assert.match(body, /rifiutata\.\s*Non ti scoraggiare/i,
    `${file}: manca il messaggio di incoraggiamento dopo un rifiuto`);
});

test('confirm_exchange_any blocca la conferma su una prenotazione contestata', () => {
  // Bug reale: 20260721210000_exchange_dispute.sql promette "la conferma
  // viene bloccata per entrambi finché non si risolve", ma nessuna delle
  // riscritture precedenti di confirm_exchange_any controllava mai
  // offers.disputed_at — una prenotazione contestata poteva finalizzarsi
  // normalmente come se non ci fosse nessuna contestazione in corso.
  const { file, body } = latestDefinitionOf('confirm_exchange_any');
  assert.match(body, /if\s+v_offer\.disputed_at\s+is\s+not\s+null\s+then\s+return\s+v_offer/i,
    `${file}: manca il blocco della conferma quando l'offerta è contestata`);
});

test('notify_on_chain_canceled avvisa gli altri partecipanti quando la catena decade', () => {
  // Prima nessun trigger esisteva su chain_proposals: quando la catena
  // passava a 'canceled' (rifiuto, annuncio non più disponibile) o
  // 'expired' (timeout), la proposta spariva e basta dalla lista degli
  // altri partecipanti — nessun messaggio, nessuna notifica.
  const { file, body } = latestDefinitionOf('notify_on_chain_canceled');
  assert.match(body, /new\.status\s+in\s*\(\s*'canceled'\s*,\s*'expired'\s*\)/i,
    `${file}: manca la copertura di entrambi gli stati "decaduti"`);
  assert.match(body, /non ti scoraggiare/i,
    `${file}: manca il messaggio di incoraggiamento`);
});

test('release_all_stale_reservations copre TUTTI gli utenti, non solo chi è loggato, e blocca la riga prima di scriverla', () => {
  // Analisi threat-modeling fase post-transazione (sezione A, punto 4):
  // release_my_stale_reservations è scoped ad auth.uid() e chiamata solo dal
  // client al mount di AttivitaScreen — se nessuna delle due parti riapre
  // l'app dopo la scadenza della prenotazione, gli annunci restano
  // bloccati su 'reserved' per sempre. Questa versione batch deve avere lo
  // stesso fix del lock (release_my_stale_reservations) ma SENZA il filtro
  // auth.uid(), altrimenti da un cron server-side non troverebbe mai
  // nessuna riga (auth.uid() è null fuori da un contesto utente loggato).
  const { file, body } = latestDefinitionOf('release_all_stale_reservations');
  assert.match(body, /select\s+\*\s+into\s+v_offer\s+from\s+public\.offers\s+where\s+id\s*=\s*r\.id\s+for\s+update/i,
    `${file}: manca il lock sulla riga prima della scrittura`);
  assert.match(body, /if\s+v_offer\.status\s*<>\s*'accepted'\s+then\s+continue/i,
    `${file}: manca il ricontrollo dello stato dopo il lock`);
  assert.doesNotMatch(body, /auth\.uid\(\)/i,
    `${file}: filtra per auth.uid(), un cron server-side non troverebbe mai righe da processare`);
});

test('cancel_accepted_offer_any registra chi annulla e segnala se l\'altra parte aveva già confermato', () => {
  // Threat-modeling fase post-transazione (sezione A, punto 2): prima
  // l'annullamento era completamente silenzioso — azzerava anche la
  // conferma già data dall'altra parte senza lasciare traccia di chi
  // avesse annullato o perché. Pattern di frode che questo abilitava: il
  // venditore incassa fuori app, poi annulla per far sparire ogni prova.
  const { file, body } = latestDefinitionOf('cancel_accepted_offer_any');
  assert.match(body, /cancelled_by\s*=\s*auth\.uid\(\)/i,
    `${file}: non registra più chi ha annullato`);
  assert.match(body, /cancel_reason\s*=\s*coalesce\(reason_text,\s*cancel_reason\)/i,
    `${file}: non registra più il motivo opzionale dell'annullamento`);
  assert.match(body, /suspicious_cancel_at\s*=\s*case\s+when\s+v_other_already_confirmed\s+then\s+now\(\)\s+else\s+null\s+end/i,
    `${file}: non segnala più il caso sospetto (l'altra parte aveva già confermato)`);
});

test('notify_on_offer avvisa l\'altra parte quando un\'offerta accettata viene annullata', () => {
  // Prima nessuno veniva avvisato di un annullamento (il ramo UPDATE
  // copriva solo 'accepted'/'declined'): lo scambio spariva e basta dalla
  // vista dell'altra parte, senza nessun messaggio.
  const { file, body } = latestDefinitionOf('notify_on_offer');
  assert.match(body, /old\.status::text\s*=\s*'accepted'\s+and\s+new\.status::text\s*=\s*'cancelled'/i,
    `${file}: manca il ramo che copre l'annullamento post-accettazione`);
  assert.match(body, /v_notify_user\s*:=\s*case\s+when\s+new\.cancelled_by\s*=\s*v_owner\s+then\s+new\.proposer_id\s+else\s+v_owner\s+end/i,
    `${file}: non notifica l'ALTRA parte rispetto a chi ha annullato`);
});

test('resolve_exchange_dispute richiede una disputa aperta e un esito valido', () => {
  // Threat-modeling fase post-transazione (sezione A, punto 1): prima non
  // esisteva NESSUNA RPC per risolvere una disputa aperta da
  // report_exchange_problem — l'unica uscita era annullare con
  // cancel_accepted_offer_any, che ignora disputed_at e non lascia traccia
  // della disputa. Qui si verifica solo il testo (i test funzionali sulla
  // logica reale vivono nella checklist manuale, come per le altre RPC).
  const { file, body } = latestDefinitionOf('resolve_exchange_dispute');
  assert.match(body, /if\s+p_outcome\s+not\s+in\s*\(\s*'resume'\s*,\s*'cancel_favor_proposer'\s*,\s*'cancel_favor_owner'\s*\)/i,
    `${file}: manca la validazione dell'esito`);
  assert.match(body, /if\s+v_offer\.disputed_at\s+is\s+null\s+then\s*\n?\s*raise\s+exception\s+'Offer is not disputed'/i,
    `${file}: manca il controllo che l'offerta sia davvero contestata`);
  assert.match(body, /set\s+disputed_at\s*=\s*null,\s*disputed_by\s*=\s*null,\s*dispute_reason\s*=\s*null/i,
    `${file}: l'esito 'resume' non azzera più la disputa`);
  assert.match(body, /cancel_reason\s*=\s*'dispute_resolved:'\s*\|\|\s*p_outcome/i,
    `${file}: l'annullamento arbitrato non registra più l'esito in cancel_reason`);
});

test('resolve_exchange_dispute è chiamabile solo dal service_role, non dal client', () => {
  // Nessun controllo "una delle due parti" al suo interno (è un'azione
  // arbitrata dietro requireAdminSecret, non un'azione utente): non va MAI
  // esposta come RPC pubblica al client mobile.
  const sql = fs.readFileSync(
    path.join(MIGRATIONS, '20260730140000_resolve_exchange_dispute.sql'), 'utf8',
  );
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.resolve_exchange_dispute\(text,\s*text,\s*text\) FROM PUBLIC/i,
    'manca il REVOKE su resolve_exchange_dispute');
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.resolve_exchange_dispute\(text,\s*text,\s*text\) TO service_role/i,
    'manca il GRANT a service_role su resolve_exchange_dispute');
});

test('rate_chain_transaction richiede che rater e rated siano entrambi partecipanti della stessa catena completata', () => {
  // Threat-modeling fase post-transazione (sezione A, punto 3, parte 1/2):
  // prima uno scambio a 3 completato non era mai valutabile
  // (rate_transaction legge solo da offers, le catene non ci finiscono
  // mai). Qui si verifica solo il testo dei controlli chiave — la logica
  // reale (RLS, doppio cieco) resta coperta dalla checklist manuale.
  const { file, body } = latestDefinitionOf('rate_chain_transaction');
  assert.match(body, /if\s+v_chain\.status\s*<>\s*'completed'\s+then/i,
    `${file}: manca il controllo che la catena sia completata`);
  assert.match(body, /chain_participants\s+where\s+chain_id\s*=\s*p_chain_id\s+and\s+user_id\s*=\s*v_me/i,
    `${file}: non verifica più che il rater sia un partecipante`);
  assert.match(body, /chain_participants\s+where\s+chain_id\s*=\s*p_chain_id\s+and\s+user_id\s*=\s*p_rated_id/i,
    `${file}: non verifica più che il rated sia un partecipante`);
});

test('get_user_rating aggrega anche i voti di catena rivelati, non solo quelli 1:1', () => {
  // Bug che l'estensione sopra creerebbe da sola se dimenticato: senza
  // questo, rate_chain_transaction scriverebbe voti che get_user_rating
  // (l'UNICO aggregato letto dal profilo) non conterebbe mai.
  const { file, body } = latestDefinitionOf('get_user_rating');
  assert.match(body, /r\.chain_id\s+is\s+not\s+null\s+and\s+exists/i,
    `${file}: non conta più i voti di catena`);
  assert.match(body, /r2\.chain_id\s*=\s*r\.chain_id\s+and\s+r2\.rater_id\s*=\s*r\.rated_id\s+and\s+r2\.rated_id\s*=\s*r\.rater_id/i,
    `${file}: la condizione di "rivelato" per un voto di catena non cerca più la riga reciproca`);
});

test('report_chain_problem richiede una catena completata e reporter/accusato entrambi partecipanti', () => {
  // Threat-modeling fase post-transazione (sezione A, punto 3, parte 2/2):
  // prima non esisteva NESSUN equivalente di report_exchange_problem per
  // le catene a 3 — un solo partecipante disonesto danneggiava due
  // persone innocenti senza che nessuna delle due avesse modo di
  // segnalarlo (verificato con grep incrociato su tutte le migrations e
  // su server/src/models/chains.js).
  const { file, body } = latestDefinitionOf('report_chain_problem');
  assert.match(body, /if\s+v_chain\.status\s*<>\s*'completed'\s+then/i,
    `${file}: manca il controllo che la catena sia completata`);
  assert.match(body, /chain_participants\s+where\s+chain_id\s*=\s*p_chain_id\s+and\s+user_id\s*=\s*v_me/i,
    `${file}: non verifica più che il reporter sia un partecipante`);
  assert.match(body, /chain_participants\s+where\s+chain_id\s*=\s*p_chain_id\s+and\s+user_id\s*=\s*p_accused_id/i,
    `${file}: non verifica più che l'accusato sia un partecipante`);
  assert.match(body, /insert\s+into\s+public\.chain_messages/i,
    `${file}: non pubblica più il motivo in chat, come report_exchange_problem coi 1:1`);
});

test('resolve_chain_dispute è chiamabile solo dal service_role e richiede un esito valido', () => {
  const { file, body } = latestDefinitionOf('resolve_chain_dispute');
  assert.match(body, /if\s+p_outcome\s+not\s+in\s*\(\s*'upheld'\s*,\s*'dismissed'\s*\)/i,
    `${file}: manca la validazione dell'esito`);
  assert.match(body, /if\s+v_dispute\.resolved_at\s+is\s+not\s+null\s+then/i,
    `${file}: non impedisce più di risolvere due volte la stessa disputa`);

  const sql = fs.readFileSync(
    path.join(MIGRATIONS, '20260730160000_chain_disputes.sql'), 'utf8',
  );
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.resolve_chain_dispute\(uuid,\s*text,\s*text\) FROM PUBLIC/i,
    'manca il REVOKE su resolve_chain_dispute');
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.resolve_chain_dispute\(uuid,\s*text,\s*text\) TO service_role/i,
    'manca il GRANT a service_role su resolve_chain_dispute');
});

test('remind_stale_chain_confirmers avvisa solo le catene con ESATTAMENTE 2/3 conferme vicine alla scadenza, una volta sola', () => {
  // Threat-modeling fase post-transazione (sezione A, punto 5, ultimo dei
  // 5): prima chi aveva già confermato 2/3 di una catena non riceveva
  // alcun segnale diverso da un silenzio totale fino alla scadenza delle
  // 48h (confirm_chain_participant si limita a ritornare lo stato
  // corrente se v_confirmed_count < 3, nessun timeout dedicato).
  const { file, body } = latestDefinitionOf('remind_stale_chain_confirmers');
  assert.match(body, /chain_participants\s+where\s+chain_id\s*=\s*cp\.id\s+and\s+confirmed\)\s*=\s*2/i,
    `${file}: non filtra più per ESATTAMENTE 2/3 conferme`);
  assert.match(body, /cp\.reminder_sent_at\s+is\s+null/i,
    `${file}: manca la deduplicazione (rispedirebbe il promemoria ogni 15 minuti)`);
  assert.match(body, /update\s+public\.chain_proposals\s+set\s+reminder_sent_at\s*=\s*now\(\)/i,
    `${file}: non marca più reminder_sent_at dopo l'invio`);
  assert.match(body, /where\s+part\.chain_id\s*=\s*r\.chain_id\s+and\s+not\s+part\.confirmed/i,
    `${file}: manca l'avviso di urgenza a chi non ha ancora confermato`);
  assert.match(body, /where\s+part\.chain_id\s*=\s*r\.chain_id\s+and\s+part\.confirmed/i,
    `${file}: manca la rassicurazione a chi ha già confermato`);
});

test('notify_on_chain_canceled distingue chi aveva già confermato da chi no', () => {
  // Prima il messaggio di scadenza era IDENTICO per tutti e 3 i
  // partecipanti, indipendentemente da chi avesse effettivamente fatto la
  // sua parte — nessun modo per chi aveva già confermato di sapere che il
  // problema non era stato lui.
  const { file, body } = latestDefinitionOf('notify_on_chain_canceled');
  assert.match(body, /case\s+when\s+cp\.confirmed\s+then/i,
    `${file}: non distingue più il messaggio in base a cp.confirmed`);
  assert.match(body, /Avevi già confermato la tua parte/i,
    `${file}: manca il messaggio dedicato a chi aveva già confermato`);
});

test('accept_offer_any e confirm_exchange_any scrivono accepted_at/finalized_at', () => {
  // Analisi empatia/toni amichevoli, sezione C punto 10: i due reminder
  // proattivi sotto hanno bisogno di sapere QUANDO un'offerta è diventata
  // 'accepted'/'finalized' — prima non esisteva nessun timestamp dedicato
  // (solo updated_at generico, toccato anche da conferme/dispute/cancel).
  const accept = latestDefinitionOf('accept_offer_any');
  assert.match(accept.body, /status\s*=\s*'accepted',\s*reservation_expires_at\s*=\s*now\(\)\s*\+\s*interval\s*'7 days',\s*accepted_at\s*=\s*now\(\)/i,
    `${accept.file}: accept_offer_any non scrive più accepted_at`);

  const confirm = latestDefinitionOf('confirm_exchange_any');
  assert.match(confirm.body, /status\s*=\s*'finalized',\s*finalized_at\s*=\s*now\(\)/i,
    `${confirm.file}: confirm_exchange_any non scrive più finalized_at`);
});

test('remind_pending_confirmations avvisa solo dopo 24h, esclude le offerte contestate, non rispedisce due volte', () => {
  const { file, body } = latestDefinitionOf('remind_pending_confirmations');
  assert.match(body, /o\.accepted_at\s*<\s*now\(\)\s*-\s*interval\s*'24 hours'/i,
    `${file}: non filtra più per 24h dall'accettazione`);
  assert.match(body, /o\.disputed_at\s+is\s+null/i,
    `${file}: non esclude più le offerte contestate (lì serve una risoluzione, non un nudge a confermare)`);
  assert.match(body, /o\.confirm_reminder_sent_at\s+is\s+null/i,
    `${file}: manca la deduplicazione (rispedirebbe il promemoria ogni volta che gira il cron)`);
  assert.match(body, /update\s+public\.offers\s+set\s+confirm_reminder_sent_at\s*=\s*now\(\)/i,
    `${file}: non marca più confirm_reminder_sent_at dopo l'invio`);
});

test('remind_pending_ratings avvisa solo dopo 3 giorni dalla finalizzazione, solo chi non ha ancora votato', () => {
  const { file, body } = latestDefinitionOf('remind_pending_ratings');
  assert.match(body, /o\.finalized_at\s*<\s*now\(\)\s*-\s*interval\s*'3 days'/i,
    `${file}: non filtra più per 3 giorni dalla finalizzazione`);
  assert.match(body, /not\s+exists\s*\(\s*select\s+1\s+from\s+public\.transaction_ratings\s+where\s+offer_id\s*=\s*r\.id\s+and\s+rater_id\s*=\s*r\.owner_id\s*\)/i,
    `${file}: non verifica più se il proprietario ha già votato`);
  assert.match(body, /not\s+exists\s*\(\s*select\s+1\s+from\s+public\.transaction_ratings\s+where\s+offer_id\s*=\s*r\.id\s+and\s+rater_id\s*=\s*r\.proposer_id\s*\)/i,
    `${file}: non verifica più se il proponente ha già votato`);
  assert.match(body, /update\s+public\.offers\s+set\s+rating_reminder_sent_at\s*=\s*now\(\)/i,
    `${file}: non marca più rating_reminder_sent_at dopo l'invio`);
});

test('remind_pending_confirmations e remind_pending_ratings sono chiamabili solo dal service_role', () => {
  const sql = fs.readFileSync(
    path.join(MIGRATIONS, '20260730180000_pending_confirm_and_rating_reminders.sql'), 'utf8',
  );
  for (const fn of ['remind_pending_confirmations', 'remind_pending_ratings']) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC`, 'i'),
      `manca il REVOKE su ${fn}`);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(\\) TO service_role`, 'i'),
      `manca il GRANT a service_role su ${fn}`);
  }
});

test('release_all_stale_reservations ed expire_old_offers sono chiamabili solo dal service_role, non dal client', () => {
  // Bug collaterale trovato scrivendo il test sopra: expire_old_offers non
  // ha mai avuto un REVOKE/GRANT esplicito, quindi eredita l'EXECUTE di
  // default su PUBLIC di Postgres — chiamabile via supabase.rpc(...)
  // direttamente dal client, bypassando il secret di requireCronSecret.
  const sql = fs.readFileSync(
    path.join(MIGRATIONS, '20260730120000_release_all_stale_reservations_cron.sql'), 'utf8',
  );
  for (const fn of ['release_all_stale_reservations', 'expire_old_offers']) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC`, 'i'),
      `manca il REVOKE su ${fn}`);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(\\) TO service_role`, 'i'),
      `manca il GRANT a service_role su ${fn}`);
  }
});

// ---------------------------------------------------------------------------
// Scadenza delle proposte insieme all'annuncio, e notifica al proponente
// (20260802180000). Difetto segnalato dall'uso reale: una proposta costruita
// su un annuncio scaduto restava 'pending' e in "In attesa", e quando moriva
// nessuno lo diceva a chi l'aveva mandata.
// ---------------------------------------------------------------------------

test('expire_my_stale_listings scade anche le proposte pendenti, non solo gli annunci', () => {
  const { file, body } = latestDefinitionOf('expire_my_stale_listings');
  assert.match(body, /UPDATE\s+public\.offers/i,
    `${file}: torna a scadere solo gli annunci, lasciando vive le proposte che li usano`);
  assert.match(body, /status\s*=\s*'pending'/i,
    `${file}: non filtra più sulle sole proposte pendenti`);
  // Il fix del fuso orario di 20260722140000 non deve andare perso: è la
  // regressione tipica di chi riparte da una base vecchia.
  assert.match(body, /now\(\)\s*AT\s*TIME\s*ZONE\s*'Europe\/Rome'/i,
    `${file}: perso il fix del fuso orario (CURRENT_DATE al posto di Europe/Rome)`);
  // 'paused' è reversibile: uccidere le proposte perché si è messo in pausa
  // un annuncio per un pomeriggio sarebbe un danno, non una pulizia.
  const inClause = body.match(/status::text\s+IN\s*\(([^)]*)\)/i);
  assert.ok(inClause, `${file}: manca l'elenco degli stati che fanno morire una proposta`);
  assert.ok(!/'paused'/i.test(inClause[1]),
    `${file}: 'paused' è finito fra gli stati terminali — la pausa è reversibile`);
  assert.ok(!/'reserved'/i.test(inClause[1]),
    `${file}: 'reserved' è finito fra gli stati terminali — è una trattativa in corso`);
});

test('notify_on_offer avvisa il proponente anche quando la proposta scade', () => {
  const { file, body } = latestDefinitionOf('notify_on_offer');
  assert.match(body, /'offer_expired'/,
    `${file}: nessuna notifica per le proposte scadute — il proponente resta senza segnale`);
  assert.match(body, /new\.status::text\s*=\s*'expired'/i,
    `${file}: il ramo 'expired' non riconosce più il passaggio di stato`);
  // I rami già esistenti devono sopravvivere alla riscrittura.
  for (const atteso of ["'accepted'", "'declined'", "'cancelled'", "'offer_received'"]) {
    assert.ok(body.includes(atteso),
      `${file}: perso il ramo ${atteso} riscrivendo la funzione da una base vecchia`);
  }
});

test('il CHECK di notifications ammette OGNI tipo inserito da QUALUNQUE migration', () => {
  // Il controllo che vale di più, e va fatto su TUTTE le migration, non
  // solo su quella che si sta scrivendo. Due modi di rompersi, entrambi
  // già capitati:
  //
  //   a) un trigger AFTER inserisce un tipo non ammesso → non è una
  //      notifica mancante, è l'INTERA transazione che fallisce
  //      (accettazione, rifiuto, scadenza di una proposta);
  //
  //   b) si riscrive il vincolo ripartendo da una versione vecchia e si
  //      perdono dei tipi → l'ALTER TABLE valida anche le righe GIÀ
  //      presenti e fallisce con 23514 su notifiche reali, bloccando la
  //      migration a metà. Successo per davvero: la prima stesura di
  //      20260802180000 era ripartita dai 9 tipi di 20260730130000 invece
  //      che dai 13 di 20260731130000.
  //
  // Una versione precedente di questo test guardava solo notify_on_offer e
  // non poteva vedere (b): il vincolo risultava coerente con sé stesso.

  // Ultimo CHECK definito sui tipi, per ordine di file.
  let vincolo = null;
  let vincoloFile = null;
  for (const f of [...FILES].reverse()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    const m = sql.match(/ADD\s+CONSTRAINT\s+notifications_type_check\s+CHECK\s*\(\s*type\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
    if (m) { vincolo = m[1]; vincoloFile = f; break; }
  }
  assert.ok(vincolo, 'nessun vincolo notifications_type_check trovato nelle migration');
  const ammessi = new Set([...vincolo.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

  // Letterali snake_case dentro ogni blocco `insert into public.notifications`,
  // meno quelli che non sono tipi: 'listing_unavailable' è un valore di
  // cancel_reason, confrontato lì dentro per scegliere il testo del messaggio.
  const NON_TIPI = new Set(['listing_unavailable']);
  const trovati = new Map(); // tipo -> file che lo inserisce

  for (const f of FILES) {
    const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    for (const m of sql.matchAll(/insert\s+into\s+public\.notifications\b/gi)) {
      const blocco = sql.slice(m.index, m.index + 1200);
      for (const lit of blocco.matchAll(/'((?:offer|listing|chain|new|dispute)_[a-z_]+)'/g)) {
        if (!NON_TIPI.has(lit[1]) && !trovati.has(lit[1])) trovati.set(lit[1], f);
      }
    }
  }

  assert.ok(trovati.size > 0, 'nessun tipo di notifica trovato: il test non sta controllando niente');

  for (const [tipo, f] of trovati) {
    assert.ok(ammessi.has(tipo),
      `${f} inserisce notifiche di tipo '${tipo}', ma il vincolo in ${vincoloFile} non lo ammette`);
  }
});

test('il vincolo notifications_type_check non perde mai tipi già ammessi in passato', () => {
  // Il vincolo si riscrive per intero ogni volta (DROP + ADD): togliere un
  // tipo per distrazione non dà un errore alla scrittura, lo dà in
  // produzione — sulle righe esistenti, a migration già iniziata.
  const liste = [];
  for (const f of FILES) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+notifications_type_check\s+CHECK\s*\(\s*type\s+IN\s*\(([\s\S]*?)\)\s*\)/gi)) {
      liste.push({ file: f, tipi: new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])) });
    }
  }
  assert.ok(liste.length >= 2, 'servono almeno due versioni del vincolo per confrontarle');

  const ultima = liste[liste.length - 1];
  for (const precedente of liste.slice(0, -1)) {
    for (const tipo of precedente.tipi) {
      assert.ok(ultima.tipi.has(tipo),
        `${ultima.file} non ammette più '${tipo}', che ${precedente.file} ammetteva: `
        + `l'ALTER TABLE fallirà con 23514 sulle notifiche già in tabella`);
    }
  }
});
