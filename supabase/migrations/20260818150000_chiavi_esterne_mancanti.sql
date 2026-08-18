-- Tre colonne che puntano a un utente senza dirlo al database.
--
-- chat_messages.sender_id, chain_messages.sender_id e matches.user_id sono
-- uuid di utenti, ma nessun vincolo lo dichiarava: ci si poteva scrivere
-- dentro un identificativo inventato, e la cancellazione di un utente dalla
-- dashboard di Supabase lasciava righe che puntano a nessuno.
--
-- ⚠️ Nota onesta sul rischio, che è più stretto di come l'avevo scritto nel
-- report: il percorso di cancellazione dell'APP non elimina l'utente. Lo
-- anonimizza (anonymize_account, 20260802140000): svuota il profilo, lascia
-- il guscio con "Utente eliminato" e tiene gli annunci come 'deleted',
-- apposta perché la controparte non perda la propria cronologia. Finché si
-- passa di lì, righe orfane non se ne creano. Il buco resta per la strada
-- che nessuno ha previsto: una DELETE a mano su auth.users dalla dashboard.
--
-- LE DUE REGOLE, DIVERSE DI PROPOSITO.
--
-- matches.user_id -> ON DELETE CASCADE. Un match è un suggerimento
-- ricalcolabile, non una testimonianza: sparito l'utente non ha più senso, e
-- anonymize_account già li cancella esplicitamente. Qui la cascata fa
-- esattamente ciò che il codice fa a mano.
--
-- chat_messages.sender_id e chain_messages.sender_id -> NESSUNA azione
-- (il NO ACTION predefinito), quindi la cancellazione VIENE RIFIUTATA.
-- Sembra scortese, ed è la scelta giusta: le due alternative sono peggiori.
-- CASCADE cancellerebbe metà di ogni conversazione, distruggendo la
-- cronologia della controparte — l'esatto contrario di quello che
-- anonymize_account si preoccupa di proteggere. SET NULL non è nemmeno
-- possibile senza rendere la colonna nullable, e lascerebbe messaggi senza
-- mittente in una chat a due. Con NO ACTION, invece, una DELETE dalla
-- dashboard fallisce con un errore che nomina il vincolo, e chi la stava
-- facendo capisce che la strada è anonymize_account.
--
-- Le colonne sender_id di fb_account_links e fb_sessions NON sono in questo
-- elenco anche se il report le citava: sono `text`, contengono il PSID
-- assegnato da Facebook e non hanno niente a che vedere con auth.users. Lì
-- una chiave esterna non ci può stare.
--
-- Il riferimento è auth.users e non profiles perché auth.users è la fonte
-- di verità dell'identità: un utente può esistere prima che la sua riga in
-- profiles sia stata creata, e agganciarsi a profiles renderebbe la
-- scrittura dipendente da un ordine che nessuno garantisce.
--
-- ⚠️ PRIMA DI APPLICARE, verificare che non esistano già righe orfane: se ce
--    ne sono, le ALTER falliscono. Zero righe = si può procedere.
--
--   select 'chat_messages' as tabella, count(*) from public.chat_messages m
--    where not exists (select 1 from auth.users u where u.id = m.sender_id)
--   union all
--   select 'chain_messages', count(*) from public.chain_messages m
--    where not exists (select 1 from auth.users u where u.id = m.sender_id)
--   union all
--   select 'matches', count(*) from public.matches x
--    where not exists (select 1 from auth.users u where u.id = x.user_id);

ALTER TABLE public.matches
  ADD CONSTRAINT matches_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES auth.users(id);

ALTER TABLE public.chain_messages
  ADD CONSTRAINT chain_messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES auth.users(id);
