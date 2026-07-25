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
