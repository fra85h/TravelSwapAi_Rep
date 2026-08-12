-- 20260812080000_count_route_watchers.sql
--
-- "Quante persone stanno aspettando un annuncio come il tuo?"
--
-- È il dato che nessun altro ha: la domanda dichiarata, cioè gli avvisi di
-- ricerca attivi su una tratta. Serve a chi sta scrivendo il prezzo, per
-- rispondere alla domanda vera che si fa in quel momento — "qualcuno lo
-- vorrà?" — senza inventare nessuna probabilità.
--
-- PERCHÉ UNA FUNZIONE E NON UNA QUERY DAL CLIENT.
-- saved_searches ha RLS `auth.uid() = user_id`: ognuno vede solo i propri
-- avvisi, ed è giusto così — chi li vedesse tutti saprebbe chi sta cercando
-- cosa, e a quale prezzo massimo. Questa funzione gira come proprietario e
-- restituisce SOLO UN NUMERO: nessuna riga, nessun utente, nessun prezzo.
--
-- Il conteggio è per TRATTA e non per data, perché saved_searches non ha una
-- dimensione temporale (ha tipo, tratta/località e prezzo massimo). Il testo
-- mostrato all'utente deve dire "segue questa tratta", non "in questi
-- giorni": è l'unica frase che il dato regge.
--
-- E non filtra sul prezzo massimo di proposito. Sarebbe più preciso contare
-- solo chi comprerebbe alla cifra digitata, ma quel numero cambierebbe a
-- ogni tasto e costringerebbe a una chiamata per battuta. Meglio un numero
-- stabile e vero ("segue questa tratta") che una precisione finta pagata con
-- cento richieste.

-- ------------------------------------------------------------
-- Confronto fra località, versione SQL.
--
-- Rispecchia cityMatches() di server/src/models/savedSearches.js, che è chi
-- decide davvero se un avviso scatta: campo vuoto nell'avviso = non filtra
-- su quel campo; per il resto uguaglianza, più il caso "Roma" contro "Roma
-- Termini" che è il modo in cui la gente scrive le stazioni.
--
-- È volutamente un LIMITE INFERIORE: la versione JS fa un confronto per
-- parole un po' più permissivo, quindi qui si può contare qualcuno in meno,
-- mai qualcuno in più. Promettere meno interesse di quello reale è
-- l'errore innocuo; il contrario no.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._city_overlap(wanted text, actual text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(btrim(wanted), '') = '' THEN true
    WHEN coalesce(btrim(actual), '') = '' THEN false
    ELSE lower(btrim(wanted)) = lower(btrim(actual))
      OR lower(btrim(actual)) LIKE lower(btrim(wanted)) || ' %'
      OR lower(btrim(wanted)) LIKE lower(btrim(actual)) || ' %'
  END;
$$;

-- ------------------------------------------------------------
-- Il conteggio.
--
-- p_type è text e si confronta con `s.type::text`: saved_searches.type è un
-- enum, e paragonarlo a un letterale che l'enum non conosce fallirebbe con
-- 22P02 invece di restituire zero (è la trappola descritta in CLAUDE.md).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_route_watchers(
  p_type text,
  p_cerco_vendo text DEFAULT 'VENDO',
  p_route_from text DEFAULT NULL,
  p_route_to text DEFAULT NULL,
  p_location text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.saved_searches s
  WHERE s.active
    -- I propri avvisi non contano: sapere che stai aspettando te stesso non
    -- aiuta nessuno a decidere un prezzo.
    AND s.user_id IS DISTINCT FROM auth.uid()
    AND s.type::text = p_type
    AND coalesce(s.cerco_vendo, 'VENDO') = coalesce(p_cerco_vendo, 'VENDO')
    AND CASE
          WHEN p_type = 'hotel' THEN public._city_overlap(s.location, p_location)
          ELSE public._city_overlap(s.route_from, p_route_from)
           AND public._city_overlap(s.route_to, p_route_to)
        END;
$$;

COMMENT ON FUNCTION public.count_route_watchers(text, text, text, text, text) IS
  'Quanti avvisi di ricerca attivi (di ALTRI utenti) seguono questa tratta. Restituisce solo un conteggio: saved_searches è leggibile solo dal proprietario, e chi ne vedesse le righe saprebbe chi cerca cosa e a quale prezzo.';

-- Su una SECURITY DEFINER che legge dati altrui il permesso predefinito non
-- va bene: la si apre solo a chi ha fatto l'accesso.
--
-- Servono ENTRAMBE le revoche, e la seconda non è pignoleria. Supabase
-- concede EXECUTE su tutte le funzioni di `public` anche ad `anon`, con un
-- ALTER DEFAULT PRIVILEGES: è un permesso ESPLICITO, che una revoca a PUBLIC
-- non tocca. Senza la seconda riga, chiunque da internet — senza aver fatto
-- l'accesso — potrebbe chiamarla via PostgREST; e siccome per un anonimo
-- auth.uid() è NULL, il filtro "non contare i tuoi avvisi" lascerebbe
-- passare tutto, restituendo il conteggio completo. L'ha scoperto il test
-- `chi non ha fatto l'accesso non può nemmeno chiamarla`.
REVOKE ALL ON FUNCTION public.count_route_watchers(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_route_watchers(text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.count_route_watchers(text, text, text, text, text) TO authenticated;

-- Il conteggio scandaglia saved_searches per tipo e tratta a ogni apertura
-- della schermata di pubblicazione.
CREATE INDEX IF NOT EXISTS idx_saved_searches_active_type
  ON public.saved_searches (type, cerco_vendo) WHERE active;
