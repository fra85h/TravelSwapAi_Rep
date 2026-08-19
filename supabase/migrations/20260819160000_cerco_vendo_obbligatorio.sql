-- Un annuncio deve dire se è una richiesta o un'offerta.
--
-- `cerco_vendo` è la colonna da cui dipende tutto il resto: chi può fare
-- un'offerta a chi, se c'è un bene reale in ballo, in quale direzione vanno i
-- soldi. Ed era nullable, con un vincolo che su NULL non protegge nulla —
-- `CHECK (cerco_vendo = ANY(ARRAY['CERCO','VENDO']))` con NULL vale NULL,
-- cioè passa.
--
-- Una riga con NULL non è né una cosa né l'altra, e sparisce senza far
-- rumore: heuristicScore calcola il complementare con
-- `fCV === "CERCO" ? "VENDO" : fCV === "VENDO" ? "CERCO" : null`, quindi con
-- stringa vuota il complementare è null e l'annuncio non abbina MAI, con
-- nessuno. Nell'interfaccia è peggio ancora: le schermate decidono quali
-- azioni mostrare a partire da questo campo, e su un valore che non conoscono
-- non mostrano niente.
--
-- PERCHÉ QUESTA MIGRATION RIFIUTA INVECE DI RIEMPIRE. La colonna ha un
-- DEFAULT 'VENDO', e sarebbe comodo usarlo per riempire le righe vecchie. Non
-- si fa: dichiarare VENDO significa dichiarare di avere un biglietto REALE da
-- vendere, e su un annuncio che era una richiesta lo trasformerebbe in
-- qualcosa che si può comprare. È la stessa decisione già presa nel percorso
-- Messenger, dove fbIngest.js:195 rifiuta l'import con "Missing cerco_vendo
-- (ambiguous)" invece di assumere VENDO — e il commento lì accanto spiega che
-- prima lo assumeva, ed era un guaio.
--
-- Quindi: se ci sono righe con NULL, questa migration si ferma e le conta.
-- Vanno guardate una per una e decise, non indovinate. Con zero righe — il
-- caso normale — passa senza dire niente.
--
-- ⚠️ Per vederle prima di eseguire:
--
--   select id, title, type::text, status::text, price, purchase_price,
--          accepts_swap, created_at
--     from public.listings
--    where cerco_vendo is null
--    order by created_at;
--
--   Come leggerle: un purchase_price valorizzato o accepts_swap = true
--   indicano un VENDO (chi cerca non ha comprato niente e non ha nulla da
--   scambiare). Ma è un indizio, non una prova: se resta il dubbio, la strada
--   sicura è mettere l'annuncio in pausa e chiedere a chi l'ha scritto.

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.listings WHERE cerco_vendo IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      'Ci sono % annunci con cerco_vendo NULL. Vanno decisi a mano (vedi la query in testa a questa migration): riempirli con il DEFAULT VENDO significherebbe dichiarare che hanno un biglietto reale da vendere.', n
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

ALTER TABLE public.listings
  ALTER COLUMN cerco_vendo SET NOT NULL;
