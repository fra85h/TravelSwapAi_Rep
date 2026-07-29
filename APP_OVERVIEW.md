# TravelSwapAI — come funziona l'app

Guida funzionale per chi **usa** TravelSwapAI: cosa puoi fare, cosa succede a
ogni passaggio, e cosa aspettarti quando qualcosa va storto.

Non è un manuale tecnico. È ricavata dal comportamento reale del codice, non
dalle intenzioni dichiarate: dove l'app fa una cosa diversa da quella che
sembra promettere, qui è scritto.

---

## 1. A cosa serve, e a chi

TravelSwapAI è un mercato tra privati per **biglietti del treno e
prenotazioni alberghiere che non userai**. Invece di perdere i soldi di un
viaggio saltato, puoi rivenderlo o scambiarlo con quello di qualcun altro.

È pensata per chi ha già comprato qualcosa e non può più partire: un cambio di
programma, una data sbagliata, un imprevisto. Non è un sito di prenotazioni:
qui non si comprano viaggi nuovi, si passa di mano quello che esiste già.

Due parole tornano ovunque nell'app, ed è utile capirle subito:

- **VENDO** — hai un biglietto o una prenotazione **reale** e la offri.
- **CERCO** — stai chiedendo qualcosa che ti serve. Non possiedi niente.

La differenza non è cosmetica. **Le offerte si possono fare solo verso un
VENDO**: un CERCO è una richiesta, non un bene acquistabile. E **uno scambio
richiede un biglietto da entrambe le parti** — se non hai niente da dare, puoi
solo proporre un acquisto.

---

## 2. Il primo accesso

### Cosa vedi la prima volta

All'apertura trovi un **carosello di presentazione**. Lo vedi una volta sola:
dalla seconda apertura (e dopo ogni logout) atterri direttamente sulla
schermata di accesso.

### Accedere

Puoi entrare con **email e password** oppure con **Google o Facebook**. Se hai
dimenticato la password c'è "Password dimenticata": ricevi un link via email
che ti porta su una schermata dedicata per impostarne una nuova.

### Le tue preferenze

Subito dopo la registrazione l'app ti chiede **una volta sola** che tipo di
viaggi ti interessano e in quali zone. Serve a due cose: preselezionare il
filtro giusto quando apri l'elenco, e dare priorità agli annunci della tua
zona. Puoi cambiarle in ogni momento dal profilo — non ti verranno più
richieste all'avvio.

### Cosa può andare storto

- **Schermata bianca con la rotellina all'avvio**: l'app sta controllando se
  sei già dentro. Dura poco.
- **Il link di reset password non funziona**: quel link crea una sessione
  temporanea. Se lo apri due volte, il secondo tentativo può fallire — chiedine
  uno nuovo.

---

## 3. Pubblicare un annuncio

Si parte dal pulsante centrale **➕** nella barra in basso, oppure dalla scheda
"Vendi". La pubblicazione è divisa in **due passaggi**, indicati dai due
pallini in alto.

### Passaggio 1 — Dati principali

Scegli **Hotel o Treno**, poi **Cerco o Vendo**. Sotto ci sono titolo e
descrizione.

Da qui hai tre strade per riempire i campi:

**Importare il documento.** Il riquadro giallo "Hai già il biglietto?
Importalo" legge un **QR code, un PDF, un codice di prenotazione (PNR) o una
conferma via email**. L'AI ricava tratta, date, orari, operatore e — se lo
trova — il prezzo pagato.

**Descriverlo a parole.** Scrivi in linguaggio naturale nella descrizione
("Vendo treno Palermo Mazara 546 seconda classe per il 1 agosto 08:07/10:20") e
premi **"Compila con AI"**: l'app riconosce tratta, date, orari e prezzo e
compila i campi al posto tuo.

**A mano.** Il link "Inserisci manualmente" apre tutti i campi.

C'è anche una **scopa (Pulisci)** che svuota i campi. Non tocca il tipo e la
scelta Cerco/Vendo: svuotare i dati non significa cambiare cosa stai
pubblicando.

### Passaggio 2 — Dettagli e pubblicazione

Qui inserisci tratta, date e orari, prezzo e **fino a 2 foto**. Il limite è
voluto: servono foto del biglietto o della stanza, non altro.

Se stai vendendo, c'è un campo importante: **prezzo di acquisto**, cioè quanto
l'hai pagato. Per legge non puoi rivendere un biglietto sopra il prezzo pagato,
e l'app usa quel valore come **tetto massimo**. Se importi un documento, il
prezzo viene letto direttamente da lì.

### Il Check AI

Prima di pubblicare parte una verifica automatica che assegna un punteggio di
**Affidabilità** da 0 a 100%, visibile in alto. Puoi lanciarla a mano col
pulsante "Check AI", ma **se non lo fai parte da sola** al momento della
pubblicazione: non esistono annunci mai verificati.

Il punteggio combina tre cose: controlli di base (prezzo, date, coerenza),
analisi AI del testo e analisi AI delle foto. Se non hai foto, quella parte non
viene contata contro di te.

Sotto il punteggio possono comparire due riquadri:

- **Possibili problemi** (giallo) — cosa non torna, con la spiegazione del
  perché.
- **Suggerimenti AI** (verde) — cosa puoi migliorare.

Alcuni problemi **abbassano il punteggio a forza**, indipendentemente dalla
media: una tratta impossibile lo tappa a 35%, una durata di viaggio non
plausibile a 45%, foto non pertinenti al 55%.

### Quando la verifica non riesce

Può capitare che il servizio AI non risponda (troppe richieste in poco tempo,
servizio momentaneamente giù). In quel caso **non ricevi nessun punteggio**:
l'annuncio mostra una pastiglia grigia **"Verifica in corso"**, senza
percentuale e senza colore di giudizio.

È voluto, ed è la differenza tra due cose che sembrano uguali: *«abbiamo
controllato e non convince»* è un giudizio, *«non siamo riusciti a
controllare»* è l'assenza di un giudizio. Mostrarti un numero basso per un
problema nostro ti farebbe apparire meno affidabile agli occhi dei compratori
senza che tu abbia sbagliato niente.

L'annuncio resta pubblicabile e visibile, ma **non compare nelle ricerche
filtrate per affidabilità** finché non c'è un punteggio vero. La verifica
viene **ripresa da sola**: quando riapri l'app e il servizio risponde, il
punteggio arriva e la pastiglia grigia sparisce, senza che tu debba fare
niente.

Su Messenger funziona allo stesso modo: se la verifica non riesce, il bot
salva l'annuncio come bozza e lo pubblica appena può, senza chiederti di
ripetere la procedura.

### Cosa può andare storto

- **"Verifica non riuscita"** — la verifica automatica non è andata a buon fine
  e la pubblicazione si ferma. Riprova dopo qualche secondo.
- **Punteggio senza spiegazione** — può capitare. L'app preferisce non dirti
  niente piuttosto che darti una motivazione sbagliata: se il controllo
  interno si accorge che la spiegazione dell'AI contraddice quello che hai
  scritto, la nasconde.
- **"Hai già 10 annunci attivi"** — c'è un tetto di 10 annunci attivi per
  persona. Metti in pausa o elimina qualcosa.
- **Annuncio duplicato** — se hai già un annuncio attivo identico (stesso tipo,
  prezzo, tratta e data) la pubblicazione viene bloccata.
- **Biglietto già in vendita** — se il codice di prenotazione è già usato da un
  altro annuncio vivo, non puoi pubblicarlo: impedisce che due persone vendano
  lo stesso biglietto.
- **Date nel passato** — un annuncio nuovo con data già trascorsa viene
  bloccato. In modifica no, così puoi correggere altro senza restare
  incastrato.
- **Il prezzo supera quello di acquisto** — bloccato, con il tetto indicato.

---

## 4. Esplorare gli annunci

La prima scheda (**Esplora**) mostra tutti gli annunci attivi degli altri.

Hai tre filtri rapidi — **Tutti / Hotel / Treni** — e una **ricerca testuale**
libera. Il filtro parte già impostato sul tipo che avevi indicato nelle
preferenze, e gli annunci della tua zona salgono in cima.

Ogni annuncio in elenco mostra tratta o località, date, prezzo e il **badge di
affidabilità** colorato: verde sopra l'85%, giallo sopra il 70%, rosso sotto.

Trascina verso il basso per aggiornare. L'elenco si ricarica anche ogni volta
che torni su questa scheda.

### Dentro un annuncio

Toccandolo si apre il dettaglio con tutte le informazioni, la descrizione
completa e:

- la **stella** per salvarlo tra i preferiti;
- **"Analisi prezzo con AI"**, che ti dice se il prezzo richiesto è in linea;
- la **traduzione** della descrizione nella tua lingua;
- i pulsanti per **proporre un acquisto o uno scambio**;
- il link al **profilo del venditore**, con i suoi altri annunci attivi.

Se l'annuncio è tuo, al posto delle proposte trovi **"Modifica annuncio"**.

### Stati che puoi incontrare

- **"Nessun risultato per …"** — la ricerca non ha trovato niente.
- **Elenco vuoto con filtro attivo** — prova a tornare su "Tutti".
- **Analisi prezzo non disponibile** — il servizio AI è momentaneamente
  irraggiungibile.

---

## 5. I suggerimenti "Per te"

Nella schermata Esplora c'è una sezione **Per te**, e una schermata dedicata
("Suggeriti dall'AI") con l'elenco completo.

Sono gli abbinamenti che l'AI trova **tra i tuoi annunci e quelli degli
altri**. Il punteggio di compatibilità considera il tipo, la
complementarità e la tratta; sopra a questo pesano il tuo budget e la
vicinanza tra le date.

Quando l'abbinamento è **reciproco** (tu vuoi quello che offre lui e viceversa)
viene evidenziato: è il caso migliore.

### Cosa può andare storto

- **"Nessun suggerimento per ora"** — normalmente significa che **non hai
  ancora pubblicato niente**: senza un tuo annuncio non c'è nulla da abbinare.
- Gli abbinamenti si **ricalcolano** quando pubblichi, modifichi, metti in
  pausa o elimini un annuncio. Un annuncio messo in pausa sparisce dai
  suggerimenti degli altri.

---

## 6. Chiedere informazioni prima di proporre

Su ogni annuncio altrui, sotto la descrizione, trovi **"Chiedi informazioni"**:
un elenco di domande pronte a cui il venditore risponde con un tocco. Le
risposte restano **pubbliche sull'annuncio**, così una risposta serve a tutti
quelli che guardano dopo di te.

Non è una chat: non si scrive testo libero, né nelle domande né nelle
risposte. È una scelta di protezione — senza campi liberi non c'è modo di
scambiarsi contatti fuori dall'app prima del tempo, e nessuno vede chi ha
fatto la domanda (solo la risposta è pubblica).

Per i **treni** puoi chiedere: operatore e classe (solo se non sono già
scritti sulla scheda), se il biglietto è modificabile o rimborsabile, una foto
del biglietto, chi si occupa del cambio nominativo e chi ne paga il costo
(solo sui biglietti nominativi), e quando avviene la consegna.

Per gli **hotel**: chi si occupa del cambio di intestatario, se la
prenotazione è modificabile o rimborsabile, che tipo di camera è
(matrimoniale, doppia a due letti, singola), quante camere comprende, se sono
ammessi animali, se c'è il parcheggio, una foto della camera e l'aggiunta del
nome dell'hotel all'annuncio.

Quando chiedi, il venditore riceve una notifica; quando risponde, la ricevi
tu. Ogni domanda si può fare **una sola volta** per annuncio. Se ti viene
chiesta una foto del biglietto o della prenotazione, l'app ricorda al
venditore di **coprire QR e codice di prenotazione**: chi li vede potrebbe
usare il biglietto.

---

## 7. Proporre un acquisto o uno scambio

Dal dettaglio di un annuncio altrui scegli una delle due strade. **Entrambe
funzionano solo verso un VENDO**: su un CERCO i pulsanti non compaiono.

**Acquisto.** Puoi indicare un importo (facoltativo) e un messaggio.

**Scambio.** Devi scegliere **uno dei tuoi annunci VENDO** da offrire in
cambio. Se non ne hai, l'app te lo dice e ti propone di crearne uno.

Se il biglietto è **nominativo**, vieni avvisato prima ancora di proporre: il
cambio di intestazione dipende dall'operatore e non è sempre possibile.

### Dopo l'invio

La proposta arriva al proprietario, che riceve una notifica. Puoi inviarne
**una sola alla volta** per lo stesso annuncio, e puoi ritirarla.

Una proposta non accettata **scade dopo 48 ore**.

### Quando viene accettata

Succedono tre cose insieme:

1. i due annunci passano in stato **prenotato** e spariscono dalla circolazione;
2. tutte le **altre proposte** su quell'annuncio vengono rifiutate
   automaticamente;
3. si apre la **chat** tra voi due.

La prenotazione dura **7 giorni**.

### Cosa può andare storto

- **"Proposta non più valida"** — nel frattempo il viaggio è passato, oppure
  uno dei due annunci è già stato impegnato in un altro scambio.
- **"Hai già una proposta in attesa"** — ne puoi avere una per annuncio.
- **"Importo non valido"** — lascia il campo vuoto o inserisci un numero.

---

## 8. Concludere lo scambio: la chat e la doppia conferma

La chat serve a mettervi d'accordo: dove, quando, come passarvi il biglietto.

In cima trovi lo stato del patto e il tempo che resta. Per chiudere servono
**due conferme, una per parte**. Finché conferma uno solo, si legge "Hai
confermato — in attesa dell'altro".

Quando confermate entrambi, lo scambio è **concluso e non più annullabile**: i
due annunci diventano definitivamente scambiati o venduti e non si possono più
modificare.

Hai anche due vie d'uscita:

- **Annulla scambio** — se non è andata a buon fine, entrambi gli annunci
  tornano attivi e disponibili.
- **Segnala un problema** — blocca la conferma per entrambi finché non
  risolvete, scegliendo un motivo da un elenco.

### Cosa può andare storto

- **"L'annuncio non è più disponibile"** al momento della conferma: uno dei due
  biglietti è stato concluso altrove. La proposta si annulla da sola e libera
  il lato ancora libero, invece di lasciarti bloccato.
- **Conferma solo dopo aver ricevuto e verificato**: l'app te lo ricorda con un
  avviso, perché dopo non si torna indietro.

---

## 9. Scambi a 3

A volte due persone non si incastrano, ma tre sì: tu dai a qualcuno, quella
persona dà a un'altra, che dà a te. L'app cerca questi **anelli chiusi** da
sola, in automatico e in background **ogni 15 minuti** — non devi attivare
nulla, e funziona anche se hai più di un annuncio in vendita
contemporaneamente.

Ogni proposta mostra subito, in due riquadri ben distinti, **cosa cedi** e
**cosa ricevi**. Il meccanismo completo — chi dà cosa a chi, in che ordine —
resta disponibile aprendo "Vedi i dettagli del cerchio", per chi vuole
capire come si chiude il giro prima di fidarsi. Un indicatore a pallini
mostra quanti dei 3 partecipanti hanno già confermato.

Puoi **confermare**, **ritirare la conferma** finché lo scambio non è
chiuso, oppure rifiutare: in quel caso la catena decade per tutti e 3, senza
che nessuno perda l'annuncio.

Quando tutti e tre confermano, lo scambio è concluso — lo ritrovi nello
storico — e si apre una **chat dedicata fra i 3 partecipanti** per
organizzare la consegna dei biglietti. Si apre solo a scambio concluso, mai
prima: finché manca anche una sola conferma il giro può ancora saltare.

Mentre l'app sta cercando in background uno scambio a 3 che ti riguarda,
l'icona della sezione Attività cambia temporaneamente (diventa l'icona a 3
nodi) per segnalartelo.

### Limite da conoscere

Le valutazioni a stelle (§8) oggi coprono solo gli scambi 1:1: uno scambio a
3 concluso non genera ancora un voto per i partecipanti.

---

## 10. Avvisi di ricerca

Se quello che cerchi non c'è ancora, crea un **avviso**: tipo di viaggio,
tratta o località, prezzo massimo. Quando compare un annuncio che corrisponde,
lo trovi nella scheda Attività e ricevi una notifica.

Gli avvisi si possono **sospendere e riattivare** con un interruttore, senza
cancellarli.

---

## 11. Preferiti, notifiche, attività

**Preferiti** — la stella su un annuncio lo salva in un elenco a parte. Se è
vuoto, l'app te lo dice e spiega come aggiungerne.

**Valutazioni** — a scambio concluso, in chat compare la richiesta di dare da
**1 a 5 stelle** all'altra persona. Solo stelle, nessun testo. Il voto è
**definitivo** e resta **nascosto all'altra persona** finché non vota anche
lei (o per 14 giorni): serve a evitare i voti per ritorsione, perché quando
voti non sai cosa ha messo l'altro.

La media compare accanto al nome — **★ 4,7 (12)** — sul profilo venditore, nel
dettaglio annuncio e sul tuo profilo. Sotto i 3 voti si legge **"Nuovo"**
invece della media: una media di 5,0 su un voto solo non dice niente.

**Notifiche** — un elenco cronologico. Ti avvisa quando ricevi una proposta,
quando la tua viene accettata o rifiutata, e quando arrivano nuovi annunci
adatti a te. Se hai dato il permesso, arrivano anche come notifiche push.

**Attività** — la scheda che raccoglie tutto ciò che ti riguarda: proposte
ricevute e inviate, scambi a 3 da confermare, risultati dei tuoi avvisi, chat
aperte e storico. È il posto da cui riprendere una conversazione lasciata a
metà.

---

## 12. Gestire i tuoi annunci

Dal **Profilo** vedi tutti i tuoi annunci, filtrabili per stato.

Puoi:

- **mettere in pausa e riattivare** — reversibile quante volte vuoi;
- **modificare** — finché non è concluso;
- **eliminare** — con conferma.

Due cose da sapere:

- **Eliminare è definitivo.** Un annuncio eliminato non si riattiva, altrimenti
  sarebbe solo un'altra pausa.
- **Riattivare conta come pubblicare**: se sei già a 10 annunci attivi, la
  riattivazione viene bloccata.
- **Un annuncio venduto o scambiato non è più modificabile né eliminabile**:
  fa parte dello storico di uno scambio avvenuto e resta lì. Il pulsante
  "Elimina" su questi annunci non compare proprio.

Se modifichi il contenuto di un annuncio (titolo, descrizione, prezzo, tratta,
date, foto) **l'affidabilità viene azzerata**: il punteggio vecchio si riferiva
a un testo che non esiste più. Rilancia il Check AI per riaverlo — e nel
frattempo l'annuncio resta fuori dagli elenchi filtrati per affidabilità.

---

## 13. Pubblicare da Messenger

Puoi collegare il tuo account a **Facebook Messenger** dalla schermata
"Collega Messenger": l'app genera un codice usa-e-getta, tu lo mandi alla
Pagina TravelSwapAI e il collegamento è fatto.

Da lì puoi pubblicare un annuncio conversando col bot, senza aprire l'app.

**Gli annunci pubblicati da Messenger passano dagli stessi controlli** di
quelli creati dall'app: Check AI, punteggio minimo, moderazione dei contenuti.
Se l'annuncio non supera la soglia, il bot te lo dice e non pubblica niente.

Nel codice è previsto anche il canale **Instagram**, con gli stessi controlli.
Perché funzioni serve però una configurazione lato Meta (collegamento
dell'account alla Pagina e autorizzazione ai messaggi): se non è stata fatta,
il canale semplicemente non riceve nulla.

---

## 14. Lingue

L'app è disponibile in **italiano, inglese e spagnolo**. La lingua si cambia
dal profilo e vale ovunque, comprese le spiegazioni dell'AI e la traduzione
delle descrizioni altrui.

---

## 15. Mappa delle schermate

```
Primo avvio
  Presentazione (una volta sola)  →  Accesso  →  Le tue preferenze (una volta)
                                      ↑ ↓
                                Password dimenticata → Nuova password

Dopo l'accesso — quattro schede in basso
  ┌───────────┬───────────┬───────────┬───────────┐
  │  Esplora  │   Vendi   │ Attività  │  Profilo  │
  └───────────┴───────────┴───────────┴───────────┘
```

| Da dove parti | Dove arrivi |
|---|---|
| **Esplora** | Dettaglio annuncio · Suggeriti dall'AI · Preferiti |
| **Dettaglio annuncio** | Proponi acquisto/scambio · Profilo venditore · Modifica (se è tuo) |
| **Proponi acquisto/scambio** | torna al dettaglio; a proposta accettata → Chat |
| **Vendi (➕)** | Nuovo annuncio, passaggio 1 → passaggio 2 → pubblicato |
| **Attività** | Dettaglio proposta · Chat · Scambi a 3 · Avvisi di ricerca |
| **Chat** | conferma, annullamento, segnalazione problema |
| **Profilo** | I tuoi annunci · Modifica profilo · Le tue preferenze · Notifiche · Preferiti · Avvisi di ricerca · Collega Messenger · Lingua |

---

## 16. Stati che incontrerai

**Caricamento.** Rotellina all'avvio mentre l'app controlla la sessione;
rotellina negli elenchi al primo caricamento. Durante il Check AI compare un
**micro-registro** che elenca i passaggi ("Analizzo le foto…", "Verifica
affidabilità…") con una barra di avanzamento: quella verifica può richiedere
qualche decina di secondi, soprattutto con le foto.

**Elenchi vuoti.** Ognuno ha un testo che spiega *perché* è vuoto e cosa fare:
i preferiti dicono di usare la stella, le notifiche spiegano quando
arriveranno, i suggerimenti dicono che serve prima pubblicare un annuncio.

**Errori.** Arrivano come finestre di avviso con un messaggio in chiaro. Gli
aggiornamenti che avvengono **in sottofondo** (quando torni su una scheda) non
mostrano errori e non svuotano quello che stai già vedendo: se la rete cade,
resti con i dati di prima invece di trovare una schermata vuota.

**Aggiornamento.** Quasi tutti gli elenchi si aggiornano trascinando verso il
basso, e si ricaricano da soli quando ci torni sopra.

---

## 17. Cosa l'app NON fa

Limiti reali, ricavati dal codice:

- **Non gestisce pagamenti.** Non c'è nessun sistema di pagamento integrato:
  l'app registra che uno scambio o una vendita è avvenuta, ma **i soldi ve li
  scambiate voi**, fuori dall'app. Non c'è deposito di garanzia né rimborso.
- **Non gestisce i voli.** Il tipo esiste in una nota nel codice, ma nell'app
  puoi creare e cercare solo **treni e hotel**. Un testo che parla di un volo
  viene riconosciuto in fase di importazione, ma non esiste una categoria
  "Voli".
- **Non verifica che il biglietto esista davvero.** Il controllo sul codice di
  prenotazione riguarda solo la **plausibilità del formato**: l'app non
  interroga Trenitalia, Italo o gli hotel. L'affidabilità è una stima sulla
  qualità e coerenza dell'annuncio, non una garanzia.
- **Non cambia l'intestazione dei biglietti nominativi.** Ti avvisa che il
  biglietto è nominativo, ma il cambio nome dipende dall'operatore e lo dovete
  gestire voi.
- **Non fa scambi a 4 o più.** Le catene automatiche cercano solo anelli di
  esattamente tre persone.
- **Non include nelle catene chi ha più di un annuncio in vendita.**
- **Non ha recensioni scritte.** La reputazione è solo un voto da 1 a 5
  stelle a transazione conclusa: nessun commento, nessuna risposta del
  venditore. Meno ricco di eBay, ma anche senza niente da moderare.
- **Non si può cambiare un voto già dato**, né vedere chi ti ha votato cosa:
  esce solo la media.
- **Non permette più di 2 foto per annuncio**, e si aspetta che siano
  pertinenti: foto non attinenti abbassano il punteggio.
- **Non riattiva un annuncio eliminato.**
- **Non permette di modificare un annuncio già venduto o scambiato.**
- **Non ha una chat libera prima dell'accordo.** Prima di proporre puoi solo
  usare le domande a risposta chiusa (vedi sopra): il testo libero arriva
  esclusivamente con la chat, dopo che una proposta è stata accettata.
- **Non consegna nulla.** Nessuna spedizione, nessun ritiro: l'accordo su come
  passarsi il biglietto si prende in chat.

---

## 18. In sintesi

Il percorso tipico, dall'inizio alla fine:

1. Ti registri e dici cosa ti interessa.
2. Pubblichi il biglietto che non userai — importandolo o descrivendolo a
   parole. L'app lo verifica e gli dà un punteggio di affidabilità.
3. Guardi cosa c'è in giro, oppure lasci che l'AI ti suggerisca gli
   abbinamenti migliori con quello che hai.
4. Proponi un acquisto o uno scambio. Se non trovi niente, crei un avviso.
5. Quando accettano, l'annuncio si prenota per 7 giorni e si apre la chat.
6. Vi mettete d'accordo, vi passate il biglietto, e **confermate entrambi**.
7. Se qualcosa va storto, annullate o segnalate: gli annunci tornano
   disponibili.

I soldi, il passaggio del biglietto e la fiducia restano tra voi due. L'app vi
fa incontrare, controlla che gli annunci siano sensati e tiene il conto di chi
ha confermato cosa.
