-- ============================================================
-- Tariffa del biglietto e trasferibilità del nominativo.
--
-- Contesto: l'app sapeva già dire SE un biglietto è nominativo
-- (listings.is_named_ticket) ma non se quel nominativo si può CAMBIARE —
-- che è la cosa che decide se il biglietto è davvero utilizzabile da chi lo
-- compra. Sono due concetti diversi: un biglietto può essere intestato e
-- comunque reintestabile (a volte a pagamento), oppure intestato e basta.
--
-- La tariffa commerciale (Base, Economy, Super Economy, Flex, Low Cost...)
-- è il dato da cui la trasferibilità di norma discende, e fino a oggi non
-- veniva raccolta da nessuna parte.
--
-- SCELTA DI FONDO: si AVVISA, non si blocca. Una deduzione automatica che
-- impedisce di pubblicare sarebbe il primo punto del progetto in cui un
-- errore del modello produce un danno diretto e senza appello per un utente
-- onesto (biglietto legittimo, pubblicazione negata, nessun modo di
-- dimostrare che la lettura era sbagliata). In più i Termini dichiarano
-- esplicitamente che il servizio non verifica i biglietti: bloccare
-- equivarrebbe ad affermare che ciò che resta pubblicato È trasferibile,
-- cioè la garanzia che i Termini escludono.
-- ============================================================

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS fare_type text,
  ADD COLUMN IF NOT EXISTS name_change_allowed boolean,
  ADD COLUMN IF NOT EXISTS name_change_source text;

COMMENT ON COLUMN public.listings.fare_type IS
  'Tariffa commerciale del biglietto (Base, Economy, Super Economy, Flex, Low Cost...). Testo libero e non enum, per la stessa ragione di ticket_class: le denominazioni cambiano da operatore a operatore e nel tempo, un enum andrebbe migrato a ogni listino nuovo.';

COMMENT ON COLUMN public.listings.name_change_allowed IS
  'Il biglietto consente il cambio nominativo? NULL = non si sa (ed è un valore legittimo, non un dato mancante da riempire a forza): senza tariffa riconosciuta è più onesto tacere che indovinare.';

COMMENT ON COLUMN public.listings.name_change_source IS
  'Da dove viene name_change_allowed: "declared" se lo ha dichiarato il venditore, "fare" se è dedotto dalla tariffa. Serve alla UI per dirlo all''utente: "il venditore dichiara" e "in base alla tariffa" hanno un peso diverso e vanno distinti.';

-- Il vincolo tiene insieme i due campi: un''origine senza valore (o
-- viceversa) descriverebbe uno stato che non esiste.
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_name_change_source_check;
ALTER TABLE public.listings ADD CONSTRAINT listings_name_change_source_check
  CHECK (
    (name_change_allowed IS NULL AND name_change_source IS NULL)
    OR (name_change_allowed IS NOT NULL AND name_change_source IN ('declared', 'fare'))
  );
