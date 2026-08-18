-- Due città combaciano? Una regola sola, non due.
--
-- La stessa domanda — "questo annuncio riguarda la città che segui?" — era
-- scritta due volte, in due linguaggi, con due risposte diverse:
--
--   * cityMatches() in server/src/models/savedSearches.js, che decide chi
--     riceve DAVVERO l'avviso di ricerca salvata: toglie gli accenti, taglia
--     la stringa al primo " — " e confronta gli INSIEMI DI PAROLE, in modo
--     che "Milano Centrale" e "Centrale Milano" combacino;
--
--   * _city_overlap() qui nel database (20260812080000), che alimenta il
--     "N persone seguono questa tratta" mostrato mentre si scrive il prezzo:
--     confronto per PREFISSO, niente accenti, niente parole.
--
-- Il risultato è che il numero mostrato a chi pubblica contava persone
-- diverse da quelle che poi ricevono l'avviso. "Forlì" e "Forli" combaciavano
-- di là e non di qua; "Milano Centrale" e "Centrale Milano" idem. Ed è un
-- numero su cui una persona abbassa il prezzo per davvero: se dice 3 e i
-- destinatari sono 1, l'abbiamo fatta decidere su un dato inventato.
--
-- Questa migration porta la regola della JS dentro il database. La JS resta
-- l'originale (è lei a mandare gli avvisi); un test su Postgres vero
-- confronta le due su un elenco di coppie, così la prossima volta che una
-- delle due cambia se ne accorge la CI e non chi pubblica.
--
-- Nota sulla normalizzazione: normalize(..., NFD) separa la lettera dal suo
-- segno diacritico, e la regexp toglie i segni combinanti (U+0300..U+036F).
-- È esattamente quello che fa normCity() con .normalize("NFD") e la stessa
-- classe di caratteri.

/**
 * Le parole significative di un nome di città, normalizzate.
 * Gemella di normCity(cityOnly(s)) + split(/\s+/) in savedSearches.js.
 */
CREATE OR REPLACE FUNCTION public._city_words(s text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(btrim(s), '') = '' THEN '{}'::text[]
    ELSE nullif(
           regexp_split_to_array(
             btrim(
               regexp_replace(
                 -- split_part taglia al primo " — " come cityOnly(); se il
                 -- separatore non c'è restituisce la stringa intera.
                 normalize(lower(split_part(s, ' — ', 1)), NFD),
                 E'[\\u0300-\\u036f]', '', 'g'
               )
             ),
             '\s+'
           ),
           ARRAY['']::text[]
         )
  END;
$$;

COMMENT ON FUNCTION public._city_words(text) IS
  'Parole normalizzate di un nome di città (accenti tolti, taglio al primo " — "). Gemella di normCity/cityOnly in server/src/models/savedSearches.js.';

/**
 * Vero se i due nomi possono indicare lo stesso posto.
 *
 * Il campo vuoto di CHI CERCA vale "non mi interessa da dove" e combacia con
 * tutto — è la stessa scelta di cityMatches, e serve agli avvisi impostati
 * solo sul tipo. Il campo vuoto dell'ANNUNCIO invece non combacia con niente:
 * non sappiamo dove sia, e indovinare qui vorrebbe dire mandare un avviso
 * sbagliato.
 */
CREATE OR REPLACE FUNCTION public._city_overlap(wanted text, actual text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  WITH p AS (
    SELECT coalesce(public._city_words(wanted), '{}'::text[]) AS w,
           coalesce(public._city_words(actual), '{}'::text[]) AS a
  )
  SELECT CASE
    WHEN cardinality(w) = 0 THEN true
    WHEN cardinality(a) = 0 THEN false
    -- Contenimento in un verso O nell'altro: "Roma" combacia con "Roma
    -- Termini" (chi segue la città prende anche la stazione) e "Roma
    -- Termini" combacia con "Roma" (chi pubblica dalla stazione raggiunge
    -- chi segue la città). Fuori dall'ordine delle parole, di proposito.
    ELSE (w <@ a) OR (a <@ w)
  END FROM p;
$$;
