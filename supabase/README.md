# Database Supabase — schema versionato

Lo schema del database vive in `migrations/`, in ordine di applicazione:

| File | Contenuto |
|---|---|
| `20260711160000_init.sql` | Schema completo ricostruito dal backup del progetto originale (enum, 14 tabelle, 6 viste, ~25 funzioni/RPC, trigger, indici, policy RLS) |
| `20260711160001_security_hardening.sql` | Fix di sicurezza: RLS sulle 4 tabelle che ne erano prive, PNR rimosso da `listings` e dalla vista `v_last_minute`, valori enum `expired`/`deleted` mancanti |
| `20260711160003_transactions_on_accept.sql` | `accept_offer_any()` registra ora una riga in `transactions` quando un'offerta viene accettata (1 per buy, 2 per swap) — prima nessuna funzione scriveva mai in questa tabella |
| `20260711160004_fix_offer_status_norm_cast.sql` | ⚠️ **Fix critico**: `_norm()` veniva chiamata su `offers.status` (un ENUM) invece che su testo → **ogni** accettazione/rifiuto/cancellazione di un'offerta falliva sempre in produzione. Corregge 4 funzioni/trigger. |
| `20260711160005_add_missing_listing_statuses.sql` | ⚠️ **Fix critico**: l'enum `listing_status` non conteneva `pending`/`reserved`/`swapped`, valori impostati da `accept_offer_any()` — bloccava l'accettazione di **qualsiasi** offerta (stesso sintomo del fix precedente, causa diversa) |
| `20260712120000_swap_chains.sql` | **Swap a catena, fase 1** (schema + funzioni): generalizza `accept_offer_any()` a cicli di 3 utenti. `chain_proposals`/`chain_participants` (RLS attiva, visibili solo ai partecipanti), `create_chain_proposal()` (solo `service_role` — pensata per essere chiamata dal motore di matching lato server, non dal client), `confirm_chain_participant()`/`decline_chain_participant()` (chiamabili dall'app), `expire_old_chain_proposals()` (manutenzione periodica). La chiusura è atomica solo quando **tutti e 3** confermano; se nel frattempo un annuncio non è più `active` la catena decade senza toccare nulla. |
| `20260712180000_chain_explanation.sql` | **Swap a catena, fase 3**: aggiunge `chain_proposals.explanation` (testo), riempita dal server (`server/src/ai/chainExplain.js`) subito dopo la creazione della proposta — spiegazione AI con fallback a un template deterministico. |
| `20260712200000_saved_searches.sql` | **Avvisi di ricerca (D3)**: tabelle `saved_searches`/`saved_search_matches`, RLS owner-only (nessun backstop SECURITY DEFINER necessario, ogni riga appartiene interamente a un utente). |
| `20260713040000_fb_messenger_link.sql` | Collegamento identità Messenger↔account TravelSwapAI: `fb_link_codes` (codice monouso, 15 minuti) e `fb_account_links`, entrambe service-role only. |
| `20260716120000_swap_accept_terminal_state.sql` | `accept_offer_any()`: stato finale corretto per gli annunci coinvolti — `swapped` per gli scambi, `reserved` (in attesa di pagamento) per gli acquisti; prima restavano sempre bloccati su `reserved`. |
| `20260717120000_offers_require_vendo.sql` | Backstop DB: un'offerta è valida solo verso un VENDO, e uno scambio richiede un VENDO su entrambi i lati — estende `before_insert_offers_enforce`. |
| `20260717140000_listings_swap_wanted.sql` | Scambio reale tra due VENDO: nuove colonne `listings.accepts_swap`/`swap_wanted`. |
| `20260717180000_listing_images_max_two.sql` | Backstop DB: limite di 2 foto per annuncio (trigger `before_insert_listing_images_enforce`). |
| `20260717190000_fn_user_top_matches_bidirectional.sql` | `fn_user_top_matches()` espone anche la colonna `bidirectional` (prima il chiamante la ricostruiva con un proxy grezzo `score >= 80`). |
| `20260717200000_listings_lock_sensitive_columns.sql` | Trigger che blocca via UPDATE diretto la modifica di colonne sensibili (`user_id`, `trust_score`, `ai_reliability*`), indipendentemente dal client. |
| `20260717210000_listing_images_max_two_race_fix.sql` | Fix race condition sul limite di 2 foto: lock di riga (`FOR UPDATE` su `listings`) prima del conteggio. |
| `20260717220000_invalidate_listing_translations_on_edit.sql` | Trigger che invalida la cache `listing_translations` quando titolo/descrizione dell'annuncio cambiano. |
| `20260717230000_list_my_active_listings_add_cerco_vendo.sql` | `list_my_active_listings()` restituisce anche `cerco_vendo`/`route_to` (mancavano: "Proponi scambio" risultava sempre vuoto). |
| `20260718100000_fix_chain_swap_buyer_direction.sql` | ⚠️ **Fix critico**: `confirm_chain_participant()` registrava il `buyer_id` sbagliato in `transactions` per gli scambi a catena completati (direzione opposta a quella validata da `create_chain_proposal()`); include fix una-tantum dei dati storici già corrotti. `expire_old_chain_proposals()` ristretta a `service_role`. |
| `20260718110000_offers_add_expired_status.sql` | Aggiunge `'expired'` all'enum `offer_status`, isolato nel proprio file (`ALTER TYPE ... ADD VALUE` non può condividere la transazione con chi usa poi il nuovo valore). |
| `20260718110001_offers_timeout.sql` | **Timeout proposte pending (48h)**: nuova colonna `offers.expires_at`; scadenza "pigra" in `accept_offer_any`/`decline_offer_any`/`get_my_pending_offer_any`/`list_incoming_offers_any`/`list_outgoing_offers_any` (si auto-marcano `expired` se toccate o lette dopo la scadenza); `expire_old_offers()` per manutenzione batch facoltativa (nessun cron è configurato in questo progetto, vedi nota su `chain_proposals`). |
| `20260718120000_fix_before_insert_offers_enforce_norm_cast.sql` | ⚠️ **Fix critico (regressione)**: `before_insert_offers_enforce()` era già stato corretto in `20260711160004` (cast `_norm(o.status::text)`), ma `20260717120000` l'ha riscritta per il controllo VENDO/CERCO ripartendo dalla versione vecchia e perdendo quel cast — bloccava **tutte** le proposte di scambio (non gli acquisti: il conteggio rotto vive nel ramo `swap`) con `function _norm(offer_status) does not exist`. |
| `20260718130000_listings_read_swapped_reserved.sql` | `listings_read_all_active` permetteva la lettura pubblica di un annuncio non tuo solo per `active/sold/exchanged/paused/archived` — `swapped`/`reserved` (aggiunti all'enum dopo, in `20260711160005`) non erano mai stati inclusi. Effetto: nello storico (Attività → "Ricevuto"), l'annuncio ricevuto in uno scambio concluso compariva come "Annuncio" invece del titolo vero, perché la join embedded su `listings` falliva silenziosamente per RLS. |
| `20260721120000_listings_lazy_expire.sql` | Scadenza pigra: un annuncio `active` con la data di viaggio/soggiorno già passata (`depart_at`/`check_in`) viene marcato `expired` quando il proprietario apre i propri annunci (nessun cron, stesso schema delle offerte pending scadute). |
| `20260721130000_offers_seen_by_proposer.sql` | Nuova colonna `offers.seen_by_proposer`, azzerata da trigger quando l'offerta passa ad `accepted`/`declined` — notifica in-app (fase 1, senza push) per chi ha proposto. |
| `20260721140000_listings_lock_terminal_status.sql` | Backstop DB: un annuncio con stato di partenza già concluso (`sold`/`swapped`/`exchanged`/`traded`) non è più modificabile via UPDATE diretto (`before_update_listings_lock_terminal`). |
| `20260721150000_antifraud_purchase_price_and_dedup.sql` | Antibagarinaggio: nuova colonna `listings.purchase_price` con vincolo `price <= purchase_price`, più blocco annunci duplicati dello stesso venditore. |
| `20260721160000_profiles_email_verified.sql` | Nuova colonna `profiles.email_verified`, sincronizzata da `auth.users.email_confirmed_at` (backfill + trigger) per il badge "Email verificata". |
| `20260721170000_chat_messages.sql` | Nuova tabella `chat_messages` (una per offerta accettata, `chat_id = offers.id`): chat aperta solo dopo l'accettazione, esclusa per le catene a 3. |
| `20260721180000_listings_operator.sql` | Nuova colonna `listings.operator` (solo treni: Trenitalia/Italo), ricavata dall'AI in fase di import. |
| `20260721190000_two_sided_exchange_confirmation.sql` | Conferma scambio a due lati: nuove colonne `offers.owner_confirmed_at`/`proposer_confirmed_at`, nuovo stato `finalized` (`offer_status`), nuova funzione `confirm_exchange_any()`; l'accettazione mette gli annunci `reserved` senza registrare subito la transazione. |
| `20260721200000_reservation_timeout.sql` | Nuova colonna `offers.reservation_expires_at`: se la prenotazione non si chiude entro 7 giorni, si rilascia da sola e gli annunci tornano `active`. |
| `20260721210000_exchange_dispute.sql` | Nuove colonne `offers.disputed_at`/`disputed_by`/`dispute_reason`: segnalare un problema blocca la conferma per entrambe le parti finché non si risolve. |
| `20260721220000_pnr_uniqueness.sql` | Nuova colonna `listings.pnr_fingerprint` (impronta md5 del PNR normalizzato, mantenuta da trigger su `listing_secrets`): impedisce lo stesso biglietto in più annunci "vivi" contemporaneamente. |
| `20260721230000_block_accept_past_travel.sql` | `accept_offer_any()`: blocca l'accettazione se il viaggio (di uno dei due lati, per lo swap) è già passato — offerta scaduta e annunci marcati `expired` invece di finalizzare. |
| `20260722120000_notifications.sql` | Centro notifiche in-app: nuova tabella notifiche, popolata da trigger DB sugli eventi offerta (non dal client) e dal server per i nuovi match. |
| `20260722130000_handshake_name_change.sql` | `get_offer_handshake()` espone anche se il biglietto che l'utente corrente sta ricevendo è nominativo (+ operatore), per il promemoria "cambio nominativo" in chat. |
| `20260722140000_fix_timezone_expiry.sql` | ⚠️ **Fix critico**: la scadenza hotel usava `CURRENT_DATE` (fuso di sessione del DB, UTC) invece del fuso italiano — per 1-2h dopo mezzanotte italiana un hotel già scaduto restava azionabile/accettabile. Fix con `(now() AT TIME ZONE 'Europe/Rome')::date`. |
| `20260722150000_listing_pings.sql` | Feature "Ping": nuova tabella `listing_pings` (UNIQUE su `from_listing_id, to_listing_id`), per segnalare al proprietario di un CERCO che esiste un VENDO corrispondente. |
| `20260723100000_pnr_plausibility_check.sql` | Check di plausibilità del PNR (5-8 alfanumerici, rifiuta caratteri tutti uguali o sequenze) bloccato in pubblicazione: `chk_pnr_plausible` (`NOT VALID`) su `listing_secrets`. |
| `20260723110000_active_listing_cap.sql` | Tetto di 10 annunci attivi per utente (`trg_listings_active_cap`): blocca nuove pubblicazioni/riattivazioni manuali oltre il tetto, non le transizioni di sistema. |
| `20260723120000_fix_exchanged_counter_status.sql` | ⚠️ **Fix critico**: `refresh_profile_counters()` contava `exchanged` solo per `status = 'exchanged'`, valore mai scritto nel codice (si scrive sempre `'swapped'`) — il contatore era sempre 0. Fix + backfill. |
| `20260723130000_fix_double_commit_listing_race.sql` | ⚠️ **Fix critico**: un annuncio offerto in più scambi poteva essere riservato due volte (`accept_offer_any()` non riverificava lo stato al momento dell'accettazione); aggiunge lock di riga in `accept_offer_any()` e gestione del conflitto già avvenuto in `confirm_exchange_any()` (nuova colonna `offers.cancel_reason`, auto-annullamento invece di un errore grezzo del trigger). |

> Le migrazioni `fix_offer_status_norm_cast` e `add_missing_listing_statuses` vanno applicate **subito** sul progetto Supabase reale (non solo nel repo): finché mancano, accettare un'offerta fallisce sempre con un errore Postgres. Scoperte testando in locale la migrazione `transactions_on_accept` prima di consegnarla — non erano mai state esercitate end-to-end. Ogni migrazione va comunque applicata non appena disponibile: nessun runner automatico la applica da sola (vedi `CLAUDE.md`).

Tutte le migrazioni sono state validate applicandole in sequenza (nell'ordine reale dei nomi file) a un PostgreSQL 16 pulito, incluso un test end-to-end con due utenti simulati per buy e swap.

## Ripristino su un nuovo progetto (il vecchio è in pausa non riattivabile)

1. **Crea il progetto**: [dashboard Supabase](https://supabase.com/dashboard) → *New project* (stessa organizzazione va bene). Salva la password del database.
2. **Applica le migrazioni**: *SQL Editor* → incolla il contenuto di ciascun file della tabella sopra, **nell'ordine dei timestamp nel nome** (`20260711160000_init.sql` per primo), → *Run* uno alla volta.
   In alternativa con la CLI: `supabase link --project-ref <nuovo-ref>` poi `supabase db push`.
3. **(Facoltativo) Dati vecchi**: il backup scaricato (`db_cluster*.backup.gz`) contiene i dati di prova (59 annunci, 5 profili). Gli account utente (`auth.users`) si recuperano solo col restore completo del backup, non con queste migrazioni — per una beta conviene ripartire con utenti nuovi.
4. **Aggiorna le chiavi** (*Settings → API* del nuovo progetto):
   - App — `travelswap_ai/travelswapai/.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - Server (Render) — variabili d'ambiente: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## Note sullo schema

- `offers.id` è **seriale intero**, non uuid: è il motivo delle RPC `*_any` "tolleranti uuid/int" usate dall'app.
- `listings.start_date` è una colonna **generata** (check_in per hotel, data di depart_at per treni).
- Le tabelle `fb_sessions`, `listing_ai_scores`, `match_snapshots`, `trust_audit`, `fb_link_codes`, `fb_account_links` sono a uso esclusivo del server (service role): RLS attiva senza policy.
- Il PNR vive **solo** in `listing_secrets` (RLS attiva, nessuna policy client).
- `chain_proposals`/`chain_participants`: stesso principio, ma con lettura concessa ai partecipanti tramite la funzione helper `_chain_participant_exists()` — una query diretta nella policy causerebbe ricorsione infinita (la policy di `chain_participants` dovrebbe interrogare `chain_participants`).
