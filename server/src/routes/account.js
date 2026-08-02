// server/src/routes/account.js — cancellazione dell'account.
//
// Passa dal server e non direttamente dal client perché servono due cose che
// un client non può e non deve fare: eseguire l'anonimizzazione con il
// service_role (la RPC non è concessa a nessun altro) e chiudere l'accesso
// tramite l'API di amministrazione di Supabase.
//
// L'ordine conta. Prima si anonimizzano i dati, poi si chiude l'accesso: se
// si invertisse e la seconda parte fallisse, resterebbe un account
// perfettamente funzionante ma già svuotato — cioè una persona che entra e
// non trova più niente di suo senza aver capito perché.
import express from "express";
import { supabase } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { rateLimitAccount } from "../middleware/rateLimit.js";

export const accountRouter = express.Router();

// Cosa impedisce la cancellazione in questo momento. Serve alla schermata per
// spiegarlo PRIMA che l'utente prema il pulsante e si prenda un rifiuto.
accountRouter.get("/deletion-blockers", requireAuth, async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data, error } = await supabase.rpc("account_deletion_blockers", { p_user_id: req.user.id });
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;
    return res.json({
      openOffers: Number(r?.open_offers || 0),
      openChains: Number(r?.open_chains || 0),
    });
  } catch (e) {
    console.error("[account][blockers]", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

accountRouter.post("/delete", requireAuth, rateLimitAccount, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "unauthenticated" });
  if (!supabase) return res.status(503).json({ error: "not_configured" });

  try {
    // 1) Anonimizzazione. Se ci sono transazioni aperte la RPC rifiuta, e il
    //    motivo va restituito com'è: "riprova più tardi" non direbbe
    //    all'utente che deve prima chiudere uno scambio in corso.
    const { data, error } = await supabase.rpc("anonymize_account", { p_user_id: userId });
    if (error) {
      const msg = String(error.message || "");
      if (/transaction\(s\) in progress|chain swap\(s\) in progress/i.test(msg)) {
        return res.status(409).json({ error: "in_progress", detail: msg });
      }
      throw error;
    }
    const summary = Array.isArray(data) ? data[0] : data;

    // 2) Chiusura dell'accesso. Non si cancella la riga in auth.users: quasi
    //    tutte le tabelle vi puntano in cascata, e sparirebbero anche i voti
    //    dati ad altri e la cronologia delle controparti (vedi la migration
    //    20260802140000). Si sostituisce l'email — che è il dato personale
    //    conservato lì — e si blocca l'account. L'indirizzo originale torna
    //    così libero, se un giorno la persona volesse riscriversi.
    const placeholder = `deleted+${userId}@invalid.local`;
    const { error: admErr } = await supabase.auth.admin.updateUserById(userId, {
      email: placeholder,
      phone: null,
      user_metadata: {},
      ban_duration: "876000h", // ~100 anni: di fatto permanente
    });
    if (admErr) {
      // I dati sono già anonimi: lo si dice, invece di far credere che non
      // sia successo niente e lasciare la persona a riprovare all'infinito.
      console.error("[account][delete] auth close failed:", admErr.message || admErr);
      return res.status(500).json({
        ok: false,
        anonymized: true,
        error: "auth_close_failed",
      });
    }

    return res.json({
      ok: true,
      listingsRemoved: Number(summary?.listings_removed || 0),
      listingsKept: Number(summary?.listings_kept || 0),
    });
  } catch (e) {
    console.error("[account][delete]", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});
