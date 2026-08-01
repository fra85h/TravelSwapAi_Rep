// server/src/models/listingQuestions.js
// Domande a risposta chiusa su un annuncio, prima di qualsiasi proposta.
//
// Stessa filosofia di models/pings.js: l'inserimento passa SOLO da qui
// (service-role), dopo aver validato le regole di dominio, così la tabella non
// ha bisogno di esporre privilegi ai ruoli pubblici. Le regole valgono anche
// se qualcuno chiama PostgREST direttamente, perché senza GRANT non ci arriva.
import { isUUID } from '../util/uuid.js';
import { supabase } from '../db.js';
import { sendExpoPush } from '../lib/push.js';
import {
  getQuestion, canAskAbout, isValidAnswer,
} from '../../../travelswap_ai/travelswapai/lib/listingQuestions.mjs';

/**
 * Registra una domanda e avvisa il proprietario.
 * @returns {{ok:true, alreadyAsked:boolean, id?:string}}
 */
export async function askListingQuestion(listingId, code, askerId) {
  if (!isUUID(listingId) || !isUUID(askerId)) throw new Error('Invalid ids');
  if (!supabase) throw new Error('Supabase non configurato');

  // Il codice deve esistere nel catalogo condiviso: è l'unica fonte di verità,
  // e non viene duplicata né qui né nella migration.
  const domanda = getQuestion(code);
  if (!domanda) throw new Error('Domanda non riconosciuta');

  const { data: listing, error } = await supabase
    .from('listings')
    .select('id, user_id, title, status, cerco_vendo, type, operator, ticket_class, is_named_ticket')
    .eq('id', listingId)
    .maybeSingle();
  if (error) throw error;

  const esito = canAskAbout(listing, askerId);
  if (!esito.allowed) throw new Error(esito.reason);

  // La domanda deve avere senso PER QUESTO annuncio: il tipo giusto, e non un
  // dato già scritto sulla scheda (chiedere l'operatore quando la colonna è
  // piena farebbe scrivere il compratore per niente).
  const tipo = String(listing.type || '').toLowerCase() === 'hotel' ? 'hotel' : 'train';
  if (domanda.type !== tipo) throw new Error('Domanda non applicabile a questo tipo di annuncio');
  if (!domanda.showWhen(listing)) throw new Error('Dato già presente nell\'annuncio');

  const { data: inserted, error: insErr } = await supabase
    .from('listing_questions')
    .insert({ listing_id: listingId, asker_id: askerId, code: domanda.code })
    .select('id')
    .single();

  if (insErr) {
    // 23505 = unique_violation: la stessa persona ha già fatto questa domanda
    // su questo annuncio (anche per un doppio tocco). Non è un errore da
    // mostrare: il risultato per l'utente è lo stesso.
    if (insErr.code === '23505') return { ok: true, alreadyAsked: true };
    throw insErr;
  }

  try {
    await supabase.from('notifications').insert({
      user_id: listing.user_id,
      type: 'listing_question',
      title: 'Nuova domanda su un tuo annuncio',
      body: `Qualcuno ha una domanda su «${listing.title || ''}»`,
      data: { listingId, questionId: inserted.id, code: domanda.code },
    });
    sendExpoPush(listing.user_id, {
      title: 'Nuova domanda',
      body: `Su «${listing.title || ''}»`,
      data: { type: 'listing_question', listingId, questionId: inserted.id },
    });
  } catch (e) {
    // La domanda è registrata: se la notifica fallisce il venditore la vede
    // comunque nel pannello delle domande in attesa.
    console.error('[listingQuestions notify]', e?.message || e);
  }

  return { ok: true, alreadyAsked: false, id: inserted.id };
}

/**
 * Verifica che una risposta sia ammessa dal catalogo. La scrittura vera la fa
 * la RPC answer_listing_question (che controlla la proprietà dell'annuncio):
 * qui si valida solo il contenuto, che il DB non può conoscere.
 */
export function validateAnswer(code, answer) {
  if (!isValidAnswer(code, answer)) throw new Error('Risposta non ammessa');
  return true;
}

/** Avvisa chi aveva chiesto che è arrivata la risposta. */
export async function notifyQuestionAnswered(questionId) {
  if (!isUUID(questionId) || !supabase) return;
  try {
    const { data: q } = await supabase
      .from('listing_questions')
      .select('id, asker_id, code, listing_id, listings(title)')
      .eq('id', questionId)
      .maybeSingle();
    if (!q?.asker_id) return;

    await supabase.from('notifications').insert({
      user_id: q.asker_id,
      type: 'listing_question_answered',
      title: 'Hanno risposto alla tua domanda',
      body: `Su «${q.listings?.title || ''}»`,
      data: { listingId: q.listing_id, questionId: q.id, code: q.code },
    });
    sendExpoPush(q.asker_id, {
      title: 'Hanno risposto alla tua domanda',
      body: `Su «${q.listings?.title || ''}»`,
      data: { type: 'listing_question_answered', listingId: q.listing_id },
    });
  } catch (e) {
    console.error('[listingQuestions answered notify]', e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Fatti sull'annuncio ricavati dalle risposte pubbliche del venditore.
//
// Le domande a risposta chiusa sono l'UNICO posto in cui certe informazioni
// esistono: la classe del biglietto non ha mai una colonna valorizzata (il
// form non la chiede), e l'operatore ce l'ha solo quando l'AI è riuscita a
// dedurlo. Il catalogo lo dice già a modo suo — `showWhen` mostra la domanda
// esattamente quando la colonna è vuota — quindi colonna e risposta sono due
// facce dello stesso dato e non entrano mai in conflitto.
//
// Servono all'analisi prezzo: classe e operatore cambiano parecchio il prezzo
// di mercato di una stessa tratta, e finora quel calcolo li ignorava anche
// quando il venditore li aveva dichiarati.
// ---------------------------------------------------------------------------

/** Domande le cui risposte pesano sul prezzo di mercato. */
export const PRICE_RELEVANT_QUESTION_CODES = ['operator', 'ticket_class'];

// "unknown" e "other" sono risposte oneste ma non informative per un prezzo:
// non identificano né l'operatore né la fascia, quindi si scartano invece di
// mandare al modello un'etichetta che non gli dice nulla.
const FACT_LABELS = {
  operator: {
    trenitalia: 'Trenitalia',
    italo: 'Italo',
  },
  ticket_class: {
    first: 'prima classe',
    second: 'seconda classe',
    business: 'business',
    standard: 'standard',
  },
};

/**
 * Estrae i fatti utili al prezzo dalle righe di listing_questions.
 * Funzione PURA: riceve le righe già lette, non tocca il database.
 *
 * Più compratori possono aver fatto la stessa domanda (il vincolo di unicità
 * è per (annuncio, chi chiede, codice), non per codice): vince la risposta
 * più recente, che è quella che il venditore considera valida oggi.
 *
 * @param {Array<{code:string, answer:string|null, answered_at:string|null}>} rows
 * @returns {{operator?: string, ticketClass?: string}}
 */
export function extractPriceFactsFromAnswers(rows) {
  const best = new Map(); // code -> { answer, at }
  for (const r of rows || []) {
    const code = String(r?.code || '');
    if (!PRICE_RELEVANT_QUESTION_CODES.includes(code)) continue;
    if (!r?.answered_at || !r?.answer) continue;
    const label = FACT_LABELS[code]?.[String(r.answer).toLowerCase()];
    if (!label) continue; // 'unknown'/'other': nessuna informazione di prezzo
    const at = new Date(r.answered_at).getTime();
    if (!Number.isFinite(at)) continue;
    const prev = best.get(code);
    if (!prev || at > prev.at) best.set(code, { answer: label, at });
  }

  const out = {};
  if (best.has('operator')) out.operator = best.get('operator').answer;
  if (best.has('ticket_class')) out.ticketClass = best.get('ticket_class').answer;
  return out;
}
