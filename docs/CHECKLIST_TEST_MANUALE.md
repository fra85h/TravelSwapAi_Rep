# Checklist di test manuale — flusso di scambio end-to-end

Verifica passo-passo di tutta la catena di scambio, con l'azione da fare in
app e la query SQL da lanciare nell'SQL Editor di Supabase per confermare
che il database sia nello stato giusto. Ogni sezione è indipendente: se una
fallisce, puoi isolarla senza rifare tutto da capo.

**Prerequisiti**
- Due account di prova distinti, loggati su due dispositivi/browser diversi
  (o due finestre in incognito) — chiamali **A** (chi pubblica) e **B** (chi
  propone).
- Accesso all'SQL Editor di Supabase.
- Recupera gli `id` dei due account una volta sola:
  ```sql
  select id, email from auth.users where email in ('email_A', 'email_B');
  ```
  Da qui in poi uso `<A>` e `<B>` per questi due UUID.

Le query sono dirette sulle tabelle (bypassano la RLS, essendo lanciate come
service-role dall'SQL Editor): mostrano lo stato reale indipendentemente da
cosa l'app filtra per l'utente.

---

## Parte 1 — Pubblicazione annuncio (account A)

- [ ] 1. Tab **Vendi** → crea annuncio treno **VENDO**, tratta reale (es.
      Roma→Milano), data futura, prezzo. Compila **a mano**, senza import,
      per testare quel percorso.
- [ ] 2. Verifica che il **Check AI** parta da solo e mostri una
      percentuale; se non è 100%, deve comparire un motivo leggibile in
      "Perché questo punteggio" — mai un numero senza spiegazione.
- [ ] 3. Pubblica.
  ```sql
  select id, status, trust_score, cerco_vendo, type, route_from, route_to,
         depart_at, price
  from listings where user_id = '<A>' order by created_at desc limit 1;
  ```
  Atteso: `status='active'`, `trust_score` non NULL (a meno che l'AI non
  abbia risposto — in quel caso `status` resta comunque `active` ma il
  punteggio è NULL, "in verifica").
- [ ] 4. Ripeti la creazione di un secondo annuncio usando **l'import
      automatico** (box giallo "Hai già il biglietto?", scegli PNR o
      incolla testo) per testare quel percorso alternativo. Nel testo
      incollato scrivi solo il nome del servizio, non dell'azienda (es.
      "biglietto Frecciarossa Roma-Milano" senza mai scrivere
      "Trenitalia"): dopo "Compila con AI" il campo **Operatore** (visibile
      nel dettaglio annuncio, sezione treno) deve risultare "Trenitalia" da
      solo — verifica anche con "Italo" (già il nome del treno).
- [ ] 5. Dal tab **Profilo**, tocca "+" per creare un terzo annuncio: deve
      comparire di nuovo il box import in cima (verifica del fix
      `navigate`→`push` — se sparisse dopo la prima visita, è regredito).

---

## Parte 2 — Scoperta e domanda pre-offerta (account B)

- [ ] 6. Tab **Esplora** → trova l'annuncio di A, apri il dettaglio.
- [ ] 7. Tocca "Chiedi informazioni" (o icona equivalente) → scegli una
      domanda dal catalogo (es. "È rimborsabile?") → invia.
  ```sql
  select id, listing_id, code, answered_at
  from listing_questions order by created_at desc limit 1;
  ```
  Atteso: riga nuova, `answered_at` NULL.
- [ ] 8. Account A: la domanda deve comparire come notifica/avviso.
      Rispondi dall'app.
  ```sql
  select answered_at from listing_questions where id = '<id sopra>';
  ```
  Atteso: non più NULL.

---

## Parte 3 — Proposta e accettazione

- [ ] 9. Account B: dal dettaglio annuncio, proponi un **acquisto**
      (o uno **scambio**, se B ha un annuncio VENDO con "Accetta anche uno
      scambio" attivo — testa entrambi i tipi in due giri separati).
  ```sql
  select id, status, type, proposer_id, to_listing_id, from_listing_id,
         amount, expires_at
  from offers order by created_at desc limit 1;
  ```
  Atteso: `status='pending'`, `type` coerente (`buy` o `swap`).
- [ ] 10. Account A: la proposta deve comparire in **Attività → Da fare**.
- [ ] 11. Account A: **accetta**.
  ```sql
  select id, status, reservation_expires_at from offers where id = '<id offerta>';
  select id, status from listings
  where id in ('<to_listing_id>', '<from_listing_id se swap>');
  ```
  Atteso: offerta `accepted`, `reservation_expires_at` ~7 giorni nel
  futuro; annuncio/i coinvolti `reserved`.
- [ ] 12. Se sull'annuncio di A c'erano ALTRE proposte pending, verifica
      che siano passate a `declined`:
  ```sql
  select id, status from offers where to_listing_id = '<to_listing_id>';
  ```

---

## Parte 4 — Chat e doppia conferma

- [ ] 13. Verifica che la chat si apra per entrambi subito dopo
      l'accettazione; scambiatevi un messaggio a testa e controlla che
      arrivi in tempo reale sull'altro dispositivo (test del realtime).
  ```sql
  select sender_id, body, created_at from chat_messages
  where offer_id = '<id offerta>' order by created_at;
  ```
- [ ] 14. Account A: tocca "Scambio avvenuto" (conferma). B deve vedere
      "L'altra persona ha confermato", A deve vedere "Hai confermato — in
      attesa dell'altro".
  ```sql
  select status, owner_confirmed_at, proposer_confirmed_at
  from offers where id = '<id offerta>';
  ```
  Atteso: `status` ancora `accepted`, solo `owner_confirmed_at` valorizzato.
- [ ] 15. Account B: conferma anche lui.
  ```sql
  select status, owner_confirmed_at, proposer_confirmed_at from offers where id = '<id offerta>';
  select id, status from listings where id in ('<to_listing_id>', '<from_listing_id se swap>');
  select * from transactions where listing_id in ('<to_listing_id>', '<from_listing_id se swap>');
  ```
  Atteso: `status='finalized'`, entrambi i confirmed_at valorizzati; annunci
  `sold` (buy) o `swapped`/`exchanged` (swap); una riga in `transactions`
  con `status='completed'` per BUY, due righe (una per lato) per SWAP.
- [ ] 16. Prova ad aprire "Modifica" su uno degli annunci coinvolti: deve
      essere nascosto o bloccato (stato terminale, mai più modificabile).

### Passaggi guidati e dichiarazione del pagamento

- [ ] 16a. Dalla chat di una proposta accettata apri **"Cosa fare adesso"**.
      Atteso: un solo passaggio espanso, il numero di passaggi mancanti in
      testa, e su ogni tappa il turno ("Tocca a te" / "Tocca a loro" /
      "Tocca a entrambi").
- [ ] 16b. Su uno **SCAMBIO**: il passaggio "Pagamento" **non deve esistere**
      (biglietto contro biglietto, fra le parti non gira denaro). Se il
      biglietto è nominativo compare invece "Cambio nominativo", intestato a
      entrambi.
- [ ] 16c. Su un **ACQUISTO**: nel passaggio "Pagamento" compare il blocco di
      dichiarazione. Registra importo, metodo e data.
  ```sql
  select user_id, role, amount, currency, method, paid_at
  from payment_declarations where offer_id = <id offerta>;
  ```
  Atteso: una riga sola, con `role` coerente (chi ha proposto l'acquisto è
  `buyer`), scritta dalla RPC e non dal client.
- [ ] 16d. **Doppio cieco**: con una sola dichiarazione fatta, l'altro account
      deve vedere "L'altra persona ha già dichiarato" ma **non** importo,
      metodo o data. Solo dopo aver dichiarato anche lui compaiono i valori.
- [ ] 16e. **Discordanza**: fai dichiarare due importi diversi. Atteso:
      avviso "Le due dichiarazioni non coincidono", e nient'altro — la
      conferma reciproca deve restare possibile (la dichiarazione è un dato
      di osservazione, non un vincolo).
- [ ] 16f. Prova a dichiarare un pagamento su uno **scambio** o con una data
      **futura**: la RPC deve rifiutare, e l'errore deve arrivare a schermo
      (non un bottone che sembra non fare nulla).

  > Nota: la logica di queste RPC non è coperta da test automatici — i test
  > lato client sostituiscono Supabase con un mock e non eseguono SQL. Un
  > errore sfuggito così (`column reference "offer_id" is ambiguous`, corretto
  > in `20260801160000`) si vede solo eseguendo davvero questi passi.

---

## Parte 5 — Valutazione

- [ ] 17. Account A: dopo la finalizzazione, in chat deve comparire la
      richiesta di voto a stelle (solo stelle, niente testo). Vota.
  ```sql
  select rater_id, rated_id, stars, created_at from transaction_ratings
  where offer_id = '<id offerta>';
  ```
- [ ] 18. Verifica che B **non** veda ancora la media di A (double-blind):
      il profilo di A deve mostrare "Nuovo" o il valore precedente, non
      questo voto.
- [ ] 19. Account B: vota anche lui.
  ```sql
  select * from transaction_ratings where offer_id = '<id offerta>';
  select * from get_user_rating('<A>');
  ```
  Atteso: due righe; l'aggregato ora include il voto di B su A (conteggio
  +1, media aggiornata) — si "rivela" solo perché ha votato anche l'altra
  parte.
- [ ] 20. Prova a votare una **seconda volta** con un valore diverso dallo
      stesso account: deve essere rifiutato (voto immutabile).
- [ ] 21. Sul profilo di A, verifica che le stelle compaiano **accanto al
      nome** (se ha raggiunto le 3 valutazioni rivelate minime — altrimenti
      "Nuovo" è corretto, non un bug).

---

## Parte 6 — Rami alternativi (non il percorso felice, ma vanno testati)

- [ ] 22. **Rifiuto**: nuova offerta pending → A la **rifiuta** (non
      accetta).
  ```sql
  select status from offers where id = '<id offerta>';
  select status from listings where id = '<to_listing_id>';
  ```
  Atteso: offerta `declined`, annuncio resta `active`.
- [ ] 23. **Annullamento post-accettazione**: accetta un'offerta, poi
      **prima di confermare** uno dei due lati annulla ("Annulla scambio").
  ```sql
  select status, owner_confirmed_at, proposer_confirmed_at from offers where id = '<id offerta>';
  select status from listings where id = '<to_listing_id>';
  ```
  Atteso: offerta `cancelled`, entrambi i confirmed_at tornano NULL,
  annuncio torna `active`.
- [ ] 24. **Contestazione**: accetta un'offerta, poi da un lato usa
      "Segnala un problema" con un motivo. Prova a confermare da entrambi i
      lati: deve restare **bloccato** finché non risolvete.
  ```sql
  select disputed_at, dispute_reason from offers where id = '<id offerta>';
  ```
- [ ] 25. **Prenotazione scaduta** (senza aspettare 7 giorni veri): accetta
      un'offerta, poi forza la scadenza a mano:
  ```sql
  update offers set reservation_expires_at = now() - interval '1 minute'
  where id = '<id offerta>';
  ```
  Riapri **Attività** in app (chiama `release_my_stale_reservations` in
  automatico all'apertura) e verifica:
  ```sql
  select status, owner_confirmed_at, proposer_confirmed_at from offers where id = '<id offerta>';
  select status from listings where id = '<to_listing_id>';
  ```
  Atteso: offerta `cancelled`, annuncio `active` — **a meno che** tu non
  abbia appena finalizzato quella stessa offerta in un altro test proprio
  ora: in quel caso deve restare `finalized`, mai tornare `cancelled` (è
  la race condition corretta di recente — se la vedi, è regredita).
- [ ] 26. **Cap annunci attivi**: pubblica fino a 10 annunci attivi con lo
      stesso account, poi prova un 11°: deve essere bloccato con un
      messaggio chiaro (non un errore grezzo di database).
- [ ] 27. **Duplicato**: pubblica due annunci con stessa tratta/data/prezzo
      sullo stesso account: il secondo deve essere bloccato o segnalato
      come "molto simile", a scelta.

---

## Parte 7 — Scambio a 3 (serve incastro di 3 account)

Il ricalcolo gira ogni 15 minuti — per non aspettare, chiama a mano
l'endpoint con il secret di cron (da `.env`/Render, variabile
`CHAIN_CRON_SECRET`):

```bash
curl -X POST https://<tuo-dominio>/api/chains/recompute \
  -H "X-Cron-Secret: <il tuo secret>"
```

- [ ] 28. Servono 3 account con annunci che si incastrano a ciclo chiuso
      (A cerca ciò che ha B, B cerca ciò che ha C, C cerca ciò che ha A —
      tutti VENDO + un CERCO a testa che punta al successivo).
- [ ] 29. Lancia la `curl` sopra.
  ```sql
  select id, status, explanation from chain_proposals order by created_at desc limit 1;
  select position, user_id, give_listing_id, receive_listing_id, confirmed
  from chain_participants where chain_id = '<id sopra>';
  ```
  Atteso: `status='proposed'`, 3 righe partecipanti, tutte `confirmed=false`.
- [ ] 30. Ciascuno dei 3 account: apri **Scambi a 3** → verifica il nuovo
      design (box "Tu cedi"/"Tu ricevi", accordion "Vedi i dettagli del
      cerchio", pallini di stato) → conferma.
  ```sql
  select position, confirmed, confirmed_at from chain_participants where chain_id = '<id>';
  ```
  (ripeti dopo ogni conferma, i pallini in app devono seguire questo
  conteggio)
- [ ] 31. **Prima** dell'ultima conferma, verifica che l'icona del tab
      **Attività** sia diventata la rete a 3 nodi (con respiro leggero) per
      chi deve ancora confermare.
- [ ] 32. Dopo la terza conferma:
  ```sql
  select status, completed_at from chain_proposals where id = '<id>';
  select status from listings where id in ('<listing1>', '<listing2>', '<listing3>');
  select * from transactions where listing_id in ('<listing1>', '<listing2>', '<listing3>');
  ```
  Atteso: `completed`, 3 annunci `reserved`, 3 righe in `transactions`.
- [ ] 33. Verifica che si apra la **chat a 3** solo ora (mai prima) e che
      l'icona del tab torni alla campanella normale.
- [ ] 34. Prova a rifiutare invece di confermare (in un giro separato, con
      dati diversi): la catena deve decadere per tutti e 3 senza che
      nessuno perda l'annuncio.

---

## Parte 8 — Funzionalità collaterali

- [ ] 35. **Avvisi di ricerca**: account B crea un avviso (CERCO salvato);
      account A pubblica un annuncio che lo soddisfa → verifica che
      compaia in "Trovato per te" per B.
- [ ] 36. **Preferiti**: salva un annuncio, verifica che compaia nella
      lista Preferiti.
- [ ] 37. **Traduzione on-demand**: cambia lingua dell'app, apri un
      annuncio non tuo → il testo deve tradursi; riapri lo stesso annuncio
      e verifica che la seconda volta sia dalla cache (più veloce, vedi
      colonna cache su DB se disponibile).
- [ ] 38. **Stima prezzo AI**: in creazione annuncio, tocca "Analizza
      prezzo con AI" → deve proporre un numero sensato per la tratta/data.
- [ ] 39. **Import da Messenger** (se hai un bot Facebook collegato):
      invia i dati di un biglietto in chat al bot → verifica che l'annuncio
      creato passi dallo stesso TrustScore gate dell'app (un punteggio
      troppo basso non deve pubblicare).
- [ ] 40. **Notifiche email** (se Resend configurato su Render, variabile
      `RESEND_API_KEY`): verifica che arrivino le email "hai ricevuto una
      proposta" e "la tua proposta è stata accettata".
- [ ] 41. **Segnalazione + link pausa/elimina** (se `REPORT_NOTIFY_TO`
      configurato): da un account, segnala un annuncio dell'altro
      (`ListingDetailScreen` → "Segnala annuncio"). Verifica che arrivi
      un'email a `REPORT_NOTIFY_TO` con due link, "metti in pausa" e
      "elimina". Apri il primo link: deve mostrare una **pagina di
      conferma** (non deve ancora succedere nulla). Tocca il bottone:
      l'annuncio deve passare a `paused`.
  ```sql
  select status from listings where id = '<listing_id segnalato>';
  select used_at from report_action_tokens where listing_id = '<listing_id>' and action = 'pause';
  ```
  Atteso: `status='paused'`, il token `pause` ha `used_at` valorizzato.
  Riapri lo **stesso** link pausa una seconda volta: deve mostrare "azione
  già eseguita", non ripetere l'azione né dare errore. Poi apri il link
  "elimina" e conferma: l'annuncio deve passare a `deleted` (terminale).
  Riprova ad aprire di nuovo il link pausa (ancora nei 7 giorni): deve
  gestire con garbo il caso "annuncio già eliminato", senza tentare di
  farlo tornare `paused`.
- [ ] 42. **Prezzo dinamico**: crea un annuncio VENDO treno con partenza tra
      pochi giorni (es. 2 giorni, dentro la finestra di default di 7),
      attiva il toggle "Prezzo dinamico" e imposta un prezzo minimo più
      basso del prezzo di vendita. Forza il ricalcolo a mano (secret di cron
      da `.env`/Render, variabile `CHAIN_CRON_SECRET`):
  ```bash
  curl -X POST https://<tuo-dominio>/api/price-decay/recompute \
    -H "X-Cron-Secret: <il tuo secret>"
  ```
  ```sql
  select price, list_price, price_floor, dynamic_pricing_enabled
  from listings where id = '<id annuncio>';
  ```
  Atteso: `price` sceso verso `price_floor` (mai sotto), coerente con i
  giorni mancanti alla partenza. Riapri l'annuncio in app: deve comparire il
  badge "Prezzo dinamico" nel dettaglio, e una notifica in-app deve
  avvisare del nuovo prezzo. Ripeti la `curl` subito dopo: il prezzo non
  deve scendere ulteriormente se non è passato abbastanza tempo (nessun
  doppio taglio nello stesso istante).

---

## Riferimento rapido — query più usate

```sql
-- Ultima offerta creata, con tutti i timestamp di conferma
select id, status, type, proposer_id, to_listing_id, from_listing_id,
       amount, expires_at, reservation_expires_at,
       owner_confirmed_at, proposer_confirmed_at, disputed_at
from offers order by created_at desc limit 5;

-- Stato di un annuncio specifico
select id, status, trust_score, user_id from listings where id = '<id>';

-- Transazioni concluse su un annuncio
select * from transactions where listing_id = '<id>';

-- Valutazioni ricevute da un utente (solo quelle rivelate)
select * from get_user_rating('<user_id>');

-- Tutte le catene attive di un utente
select cp.id, cp.status, cpart.position, cpart.confirmed
from chain_proposals cp
join chain_participants cpart on cpart.chain_id = cp.id
where cpart.user_id = '<user_id>'
order by cp.created_at desc;
```

Nota: `my_rating_for_offer` e altre RPC che usano `auth.uid()` non
funzionano da SQL Editor (lì non c'è un utente autenticato) — per quelle
usa le query dirette sulle tabelle sopra, non la RPC.
