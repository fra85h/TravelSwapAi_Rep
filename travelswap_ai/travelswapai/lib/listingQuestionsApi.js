// lib/listingQuestionsApi.js — domande a risposta chiusa sugli annunci.
//
// Divisione dei compiti, la stessa dei ping:
//  - CHIEDERE passa dal server, che valida le regole di dominio (VENDO attivo
//    di qualcun altro, domanda applicabile) e manda la notifica;
//  - LEGGERE e RISPONDERE passano da RPC, perché non serve nessuna logica di
//    dominio oltre a "chi sei", che il database sa già da auth.uid().
//
// La tabella non è raggiungibile direttamente: senza privilegi ai ruoli
// pubblici, l'unico accesso è quello che queste funzioni concedono. È anche
// il motivo per cui asker_id non esce mai — le risposte sono pubbliche, chi
// ha fatto la domanda no.
import { supabase } from "./supabase";
import { fetchJson } from "./backendApi";

/** Domande e risposte pubbliche di un annuncio. */
export async function listListingQuestions(listingId) {
  if (!listingId) return [];
  const { data, error } = await supabase.rpc("list_listing_questions", {
    p_listing_id: listingId,
  });
  if (error) {
    console.log("[listListingQuestions]", error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/** Pone una domanda. Il server rifiuta tutto ciò che non è nel catalogo. */
export async function askListingQuestion(listingId, code) {
  return fetchJson("/api/listing-questions", {
    method: "POST",
    body: { listingId, code },
  });
}

/** Le domande senza risposta sui propri annunci. */
export async function listMyPendingQuestions(maxRows = 50) {
  const { data, error } = await supabase.rpc("list_my_pending_questions", {
    max_rows: maxRows,
  });
  if (error) {
    console.log("[listMyPendingQuestions]", error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Risponde a una domanda su un proprio annuncio.
 * La scrittura la fa la RPC (che verifica di chi è l'annuncio); l'avviso a chi
 * aveva chiesto lo manda il server, e se quella chiamata fallisce la risposta
 * resta comunque salvata — è la notifica a essere best-effort, non il dato.
 */
export async function answerListingQuestion(questionId, code, answer) {
  const { data, error } = await supabase.rpc("answer_listing_question", {
    p_question_id: questionId,
    p_answer: answer,
  });
  if (error) throw error;

  try {
    await fetchJson(`/api/listing-questions/${questionId}/answered`, {
      method: "POST",
      body: { code, answer },
    });
  } catch (e) {
    console.log("[answerListingQuestion] notifica non inviata:", e?.message || e);
  }
  return data;
}
