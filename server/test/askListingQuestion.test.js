// Test funzionale del checklist manuale (docs/CHECKLIST_TEST_MANUALE.md,
// Parte 2 "Scoperta e domanda pre-offerta (account B)", step 7): account B
// pone la domanda del catalogo "È rimborsabile?" (code 'refundable') su un
// treno VENDO attivo di account A. Chiama la funzione reale dietro
// POST /api/listing-questions (askListingQuestion() in
// server/src/models/listingQuestions.js), con un mock completo del client
// Supabase — stesso approccio di createListingPublish.test.js, nessuna
// chiamata di rete vera.
//
// Fuori scope qui (serve un DB reale): vincolo di unicità 23505 (stessa
// domanda due volte), RLS. Step 8 (A risponde) passa da una RPC diversa
// (answer_listing_question) e non è coperto da questo test.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const SELLER_A = '11111111-1111-4111-8111-111111111111'; // proprietario dell'annuncio
const BUYER_B = '22222222-2222-4222-8222-222222222222'; // chi pone la domanda
const LISTING_ID = '33333333-3333-4333-8333-333333333333';

/** Query builder fake, "thenable" come quello vero di supabase-js: alcune
 * chiamate del codice reale non terminano con .single()/.maybeSingle() ma
 * vengono awaitate direttamente sulla catena (es. l'insert su notifications). */
function makeBuilder(responses) {
  const state = { payload: null };
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    in() { return builder; },
    insert(payload) {
      state.payload = payload;
      return builder;
    },
    async maybeSingle() {
      return responses.maybeSingle ? responses.maybeSingle(state) : { data: null, error: null };
    },
    async single() {
      return responses.single ? responses.single(state) : { data: null, error: null };
    },
    then(resolve, reject) {
      const result = responses.default ? responses.default(state) : { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

function buildFakeSupabase({ listingRow }) {
  const inserted = {};
  return {
    inserted,
    from(table) {
      if (table === 'listings') {
        return makeBuilder({ maybeSingle: () => ({ data: listingRow, error: null }) });
      }
      if (table === 'listing_questions') {
        return makeBuilder({
          single: (state) => {
            inserted.listingQuestion = state.payload;
            return { data: { id: 'fake-question-id-0001' }, error: null };
          },
        });
      }
      if (table === 'notifications') {
        return makeBuilder({
          default: (state) => {
            inserted.notification = state.payload;
            return { data: null, error: null };
          },
        });
      }
      if (table === 'push_tokens') {
        return makeBuilder({ default: () => ({ data: [], error: null }) });
      }
      throw new Error(`fake supabase: tabella non gestita: ${table}`);
    },
  };
}

test('Domanda pre-offerta (account B): "È rimborsabile?" su un treno VENDO attivo di A', async () => {
  const listingRow = {
    id: LISTING_ID,
    user_id: SELLER_A,
    title: 'Roma → Milano, Frecciarossa 9506',
    status: 'active',
    cerco_vendo: 'VENDO',
    type: 'train',
    operator: null,
    ticket_class: null,
    is_named_ticket: false,
  };
  const fakeSupabase = buildFakeSupabase({ listingRow });

  mock.module('../src/db.js', { namedExports: { supabase: fakeSupabase } });
  const { askListingQuestion } = await import('../src/models/listingQuestions.js');

  const result = await askListingQuestion(LISTING_ID, 'refundable', BUYER_B);

  // Stesso "atteso" della checklist manuale, step 7: la domanda è registrata.
  assert.equal(result.ok, true);
  assert.equal(result.alreadyAsked, false);
  assert.ok(result.id);

  assert.equal(fakeSupabase.inserted.listingQuestion.listing_id, LISTING_ID);
  assert.equal(fakeSupabase.inserted.listingQuestion.asker_id, BUYER_B);
  assert.equal(fakeSupabase.inserted.listingQuestion.code, 'refundable');

  // Il proprietario (A) deve ricevere l'avviso della nuova domanda.
  assert.ok(fakeSupabase.inserted.notification, 'deve notificare il proprietario');
  assert.equal(fakeSupabase.inserted.notification.user_id, SELLER_A);
  assert.equal(fakeSupabase.inserted.notification.type, 'listing_question');

  mock.reset();
});
