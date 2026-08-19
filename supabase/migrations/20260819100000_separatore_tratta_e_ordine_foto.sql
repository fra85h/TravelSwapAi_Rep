-- Due pulizie piccole, dalla coda dell'audit di integrità.
--
-- ============================================================
-- 1. Il separatore della tratta nelle righe già salvate
-- ============================================================
--
-- Nel trasporto dei dati convivono due separatori, ed è voluto: il prompt del
-- server (server/src/ai/descriptionParse.js) impone l'ASCII "-->" perché il
-- modello lo riproduce senza sbavature, mentre una freccia Unicode gli esce
-- ora in un modo ora in un altro. Il difetto era che quel formato arrivava
-- intatto fino allo schermo: un annuncio importato dalla descrizione compare
-- in vetrina come "Vendo treno Roma-->Milano solo andata" accanto a quelli
-- scritti a mano, che dicono "Roma → Milano".
--
-- Il codice ora converte al confine (lib/listingTitle.js), quindi da adesso
-- non ne nascono più. Questa UPDATE sistema quelli già pubblicati.
--
-- Perché è sicura: tutti i lettori di tratte accettano da sempre ENTRAMBE le
-- grafie — splitRoute in CreateListingScreen, routeOf in ai/score.js,
-- l'estrazione in ai/chainMatch.js usano tutti split(/-->|→/). Cambiare la
-- grafia non cambia quindi nessun comportamento: né il matching, né il
-- controllo anti-duplicato (che sui treni confronta route_from/route_to, non
-- location, e sugli hotel una località senza freccia).
--
-- Si toccano solo `title` e `location`, cioè i due campi che si leggono a
-- schermo. `description` NO: lì "-->" può essere una freccia scritta da una
-- persona per dire tutt'altro, e riscriverle il testo sarebbe di troppo.

UPDATE public.listings
   SET location = regexp_replace(location, '\s*-->\s*', ' → ', 'g')
 WHERE location LIKE '%-->%';

UPDATE public.listings
   SET title = regexp_replace(title, '\s*-->\s*', ' → ', 'g')
 WHERE title LIKE '%-->%';

-- ============================================================
-- 2. L'ordine delle foto di un annuncio
-- ============================================================
--
-- listing_images aveva solo la chiave primaria e la chiave esterna: niente
-- impediva a due foto dello stesso annuncio di avere la stessa `position`, e
-- in quel caso quale delle due facesse da copertina lo decideva l'ordine in
-- cui il database restituiva le righe — cioè cambiava da una lettura
-- all'altra. Su un massimo di due foto per annuncio significa che la
-- copertina poteva essere una volta il biglietto e una volta l'altra foto.
--
-- Prima si rinumera, poi si vincola: senza il primo passo la ALTER
-- fallirebbe su ogni annuncio che ha già il problema. La rinumerazione
-- ordina per (position, id), quindi dove l'ordine era già chiaro resta
-- identico, e dove era ambiguo viene sciolto sempre allo stesso modo invece
-- che a caso.

WITH rinumerate AS (
  SELECT id,
         row_number() OVER (PARTITION BY listing_id ORDER BY position, id) - 1 AS nuova
    FROM public.listing_images
)
UPDATE public.listing_images i
   SET position = r.nuova
  FROM rinumerate r
 WHERE i.id = r.id
   AND i.position IS DISTINCT FROM r.nuova;

-- Una foto senza indirizzo non è una foto: è una riga che l'app mostrerebbe
-- come immagine rotta. Non ne esistono (la scrittura passa sempre da
-- uploadImage, che l'url ce l'ha), ma il vincolo lo dice esplicitamente.
ALTER TABLE public.listing_images
  ALTER COLUMN url SET NOT NULL;

ALTER TABLE public.listing_images
  ADD CONSTRAINT ux_listing_images_position UNIQUE (listing_id, position);
