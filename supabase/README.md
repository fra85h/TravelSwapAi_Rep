# Database Supabase — schema versionato

Lo schema del database vive in `migrations/`, in ordine di applicazione:

| File | Contenuto |
|---|---|
| `20260711160000_init.sql` | Schema completo ricostruito dal backup del progetto originale (enum, 14 tabelle, 6 viste, ~25 funzioni/RPC, trigger, indici, policy RLS) |
| `20260711160001_security_hardening.sql` | Fix di sicurezza: RLS sulle 4 tabelle che ne erano prive, PNR rimosso da `listings` e dalla vista `v_last_minute`, valori enum `expired`/`deleted` mancanti |
| `20260711160003_transactions_on_accept.sql` | `accept_offer_any()` registra ora una riga in `transactions` quando un'offerta viene accettata (1 per buy, 2 per swap) — prima nessuna funzione scriveva mai in questa tabella |
| `20260711160004_fix_offer_status_norm_cast.sql` | ⚠️ **Fix critico**: `_norm()` veniva chiamata su `offers.status` (un ENUM) invece che su testo → **ogni** accettazione/rifiuto/cancellazione di un'offerta falliva sempre in produzione. Corregge 4 funzioni/trigger. |
| `20260711160005_add_missing_listing_statuses.sql` | ⚠️ **Fix critico**: l'enum `listing_status` non conteneva `pending`/`reserved`/`swapped`, valori impostati da `accept_offer_any()` — bloccava l'accettazione di **qualsiasi** offerta (stesso sintomo del fix precedente, causa diversa) |
| `20260712120000_swap_chains.sql` | **Swap a catena, fase 1** (schema + funzioni): generalizza `accept_offer_any()` a cicli di 3 utenti. `chain_proposals`/`chain_participants` (RLS attiva, visibili solo ai partecipanti), `create_chain_proposal()` (solo `service_role` — pensata per essere chiamata dal motore di matching lato server, non dal client), `confirm_chain_participant()`/`decline_chain_participant()` (chiamabili dall'app), `expire_old_chain_proposals()` (manutenzione periodica). La chiusura è atomica solo quando **tutti e 3** confermano; se nel frattempo un annuncio non è più `active` la catena decade senza toccare nulla. Il motore che *trova* i cicli da proporre (fase 2, lato server) non è ancora stato scritto. |

> Le due migrazioni "Fix critico" vanno applicate **subito** sul progetto Supabase reale (non solo nel repo): finché mancano, accettare un'offerta fallisce sempre con un errore Postgres. Scoperte testando in locale la migrazione `transactions_on_accept` prima di consegnarla — non erano mai state esercitate end-to-end.

Tutte le migrazioni sono state validate applicandole in sequenza (nell'ordine reale dei nomi file) a un PostgreSQL 16 pulito, incluso un test end-to-end con due utenti simulati per buy e swap.

## Ripristino su un nuovo progetto (il vecchio è in pausa non riattivabile)

1. **Crea il progetto**: [dashboard Supabase](https://supabase.com/dashboard) → *New project* (stessa organizzazione va bene). Salva la password del database.
2. **Applica le migrazioni**: *SQL Editor* → incolla il contenuto di `20260711160000_init.sql` → *Run*; poi ripeti con `20260711160001_security_hardening.sql`.
   In alternativa con la CLI: `supabase link --project-ref <nuovo-ref>` poi `supabase db push`.
3. **(Facoltativo) Dati vecchi**: il backup scaricato (`db_cluster*.backup.gz`) contiene i dati di prova (59 annunci, 5 profili). Gli account utente (`auth.users`) si recuperano solo col restore completo del backup, non con queste migrazioni — per una beta conviene ripartire con utenti nuovi.
4. **Aggiorna le chiavi** (*Settings → API* del nuovo progetto):
   - App — `travelswap_ai/travelswapai/.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - Server (Render) — variabili d'ambiente: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## Note sullo schema

- `offers.id` è **seriale intero**, non uuid: è il motivo delle RPC `*_any` "tolleranti uuid/int" usate dall'app.
- `listings.start_date` è una colonna **generata** (check_in per hotel, data di depart_at per treni).
- Le tabelle `fb_sessions`, `listing_ai_scores`, `match_snapshots`, `trust_audit` sono a uso esclusivo del server (service role): RLS attiva senza policy.
- Il PNR vive **solo** in `listing_secrets` (RLS attiva, nessuna policy client).
- `chain_proposals`/`chain_participants`: stesso principio, ma con lettura concessa ai partecipanti tramite la funzione helper `_chain_participant_exists()` — una query diretta nella policy causerebbe ricorsione infinita (la policy di `chain_participants` dovrebbe interrogare `chain_participants`).
