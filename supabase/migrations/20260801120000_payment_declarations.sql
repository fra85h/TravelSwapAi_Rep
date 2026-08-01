-- ============================================================
-- Dichiarazione del pagamento (autodichiarata, NON custodita)
--
-- Perché esiste. L'app non gestisce pagamenti: negli acquisti il denaro
-- passa direttamente fra le due persone, fuori da qui. Questo significa che
-- oggi non sappiamo NULLA di ciò che succede davvero — quanto si paga, con
-- che mezzo, quanto tempo passa fra l'accettazione e il pagamento, quante
-- volte le due parti raccontano importi diversi. Sono esattamente i numeri
-- che servono per decidere, fra qualche mese, se introdurre un pagamento in
-- custodia vale il suo costo. Senza, quella decisione sarebbe un'opinione.
--
-- Cosa NON è. Non è un vincolo: non blocca né abilita niente. La transazione
-- resta governata da confirm_exchange (conferma reciproca) esattamente come
-- prima, e una dichiarazione assente o discordante non impedisce di chiudere
-- né di valutare. È una registrazione, non una prova: le due parti scrivono
-- quello che dicono di aver fatto, e il valore del dato sta proprio nel
-- poterle confrontare.
--
-- Metodo di pagamento a elenco chiuso, mai testo libero: un campo libero qui
-- diventerebbe il posto dove la gente scrive IBAN, numeri di telefono e
-- indirizzi — dati che non vogliamo custodire e che non servono a nulla per
-- l'analisi. Nessun identificativo di pagamento viene registrato.
--
-- Doppio cieco, come per le valutazioni (20260727120000): la dichiarazione
-- dell'altra persona è visibile solo dopo aver fatto la propria. Sapere in
-- anticipo quanto ha dichiarato l'altro permetterebbe di allinearsi, e il
-- dato perderebbe il suo unico pregio — essere indipendente sui due lati.
-- Che l'altro ABBIA dichiarato si vede subito (serve a spingere a fare la
-- propria), il contenuto no.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_declarations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id    bigint NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  user_id     uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Ruolo derivato dal DB al momento della scrittura, non dichiarato dal
  -- client: chi propone un acquisto è il compratore, il proprietario
  -- dell'annuncio è il venditore.
  role        text   NOT NULL CHECK (role IN ('buyer', 'seller')),
  amount      numeric(10,2) NOT NULL CHECK (amount > 0),
  currency    text   NOT NULL DEFAULT 'EUR',
  method      text   NOT NULL CHECK (method IN ('bank_transfer','paypal','satispay','revolut','cash','other')),
  paid_at     date   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, user_id)
);

COMMENT ON TABLE public.payment_declarations IS
  'Cosa le due parti dichiarano di aver pagato/incassato fuori dall''app. Dato di osservazione, non vincolo: non blocca né abilita alcun passaggio della transazione.';

CREATE INDEX IF NOT EXISTS idx_payment_declarations_offer ON public.payment_declarations(offer_id);

ALTER TABLE public.payment_declarations ENABLE ROW LEVEL SECURITY;

-- Lettura diretta: solo le PROPRIE righe. Quella dell'altra persona passa
-- unicamente dalla RPC qui sotto, che applica il doppio cieco. Nessuna
-- policy di INSERT/UPDATE/DELETE: si scrive solo tramite declare_payment,
-- che è l'unica a poter stabilire il ruolo e a validare il contesto.
DROP POLICY IF EXISTS payment_declarations_select_own ON public.payment_declarations;
CREATE POLICY payment_declarations_select_own ON public.payment_declarations
  FOR SELECT USING (user_id = auth.uid());


-- ------------------------------------------------------------
-- Ruolo dell'utente corrente in un'offerta.
-- Serve anche fuori da qui: la schermata dei passaggi post-accettazione
-- attribuisce il turno del pagamento e senza il ruolo lo lascia
-- volutamente non attribuito (get_offer_handshake non lo espone).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_offer_role(p_offer_id bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_me    uuid := auth.uid();
  v_offer public.offers;
  v_owner uuid;
begin
  if v_me is null then return null; end if;

  select * into v_offer from public.offers o where o.id = p_offer_id;
  if not found then return null; end if;

  select l.user_id into v_owner from public.listings l where l.id = v_offer.to_listing_id;

  -- Vale solo per un acquisto: in uno scambio non esistono un compratore e
  -- un venditore, entrambi danno e ricevono un biglietto.
  if coalesce(v_offer.type, '') <> 'buy' then return null; end if;

  if v_me = v_offer.proposer_id then return 'buyer';
  elsif v_me = v_owner        then return 'seller';
  else return null;
  end if;
end;
$$;


-- ------------------------------------------------------------
-- Registra (o corregge) la propria dichiarazione.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declare_payment(
  p_offer_id bigint,
  p_amount   numeric,
  p_method   text,
  p_paid_at  date
)
RETURNS TABLE(offer_id bigint, role text, amount numeric, currency text, method text, paid_at date)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_me    uuid := auth.uid();
  v_offer public.offers;
  v_role  text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;

  select * into v_offer from public.offers o where o.id = p_offer_id;
  if not found then raise exception 'Offer not found'; end if;

  -- Cast a testo: status è un enum (offer_status) e confrontarlo con un
  -- letterale non presente nell'enum fallirebbe con 22P02.
  if v_offer.status::text not in ('accepted', 'finalized') then
    raise exception 'Payment can be declared only on an accepted transaction';
  end if;

  if coalesce(v_offer.type, '') <> 'buy' then
    raise exception 'Only purchases involve a payment between the two parties';
  end if;

  v_role := public.my_offer_role(p_offer_id);
  if v_role is null then raise exception 'Not a participant of this transaction'; end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_method is null or p_method not in ('bank_transfer','paypal','satispay','revolut','cash','other') then
    raise exception 'Unknown payment method';
  end if;
  -- Una data futura non è una dichiarazione, è un'intenzione. Il limite
  -- inferiore è la creazione dell'offerta: prima di allora non c'era niente
  -- da pagare.
  if p_paid_at is null or p_paid_at > current_date then
    raise exception 'Payment date cannot be in the future';
  end if;
  if p_paid_at < (v_offer.created_at at time zone 'UTC')::date then
    raise exception 'Payment date precedes the offer';
  end if;

  insert into public.payment_declarations as d
    (offer_id, user_id, role, amount, currency, method, paid_at)
  values
    (p_offer_id, v_me, v_role, p_amount, coalesce(v_offer.currency, 'EUR'), p_method, p_paid_at)
  on conflict (offer_id, user_id) do update
    set amount = excluded.amount,
        method = excluded.method,
        paid_at = excluded.paid_at,
        updated_at = now();

  return query
    select d.offer_id, d.role, d.amount, d.currency, d.method, d.paid_at
    from public.payment_declarations d
    where d.offer_id = p_offer_id and d.user_id = v_me;
end;
$$;


-- ------------------------------------------------------------
-- Legge le dichiarazioni con la regola del doppio cieco.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_payment_declarations(p_offer_id bigint)
RETURNS TABLE(
  my_role        text,
  mine_declared  boolean,
  mine_amount    numeric,
  mine_currency  text,
  mine_method    text,
  mine_paid_at   date,
  other_declared boolean,
  other_amount   numeric,
  other_method   text,
  other_paid_at  date,
  amounts_match  boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_me    uuid := auth.uid();
  v_mine  public.payment_declarations;
  v_other public.payment_declarations;
  v_role  text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;

  v_role := public.my_offer_role(p_offer_id);
  if v_role is null then raise exception 'Not a participant of this transaction'; end if;

  select * into v_mine
  from public.payment_declarations d
  where d.offer_id = p_offer_id and d.user_id = v_me;

  select * into v_other
  from public.payment_declarations d
  where d.offer_id = p_offer_id and d.user_id <> v_me
  limit 1;

  return query select
    v_role,
    v_mine.id is not null,
    v_mine.amount,
    v_mine.currency,
    v_mine.method,
    v_mine.paid_at,
    -- Che l'altro abbia dichiarato si sa sempre: è uno stimolo a fare la
    -- propria, e non rivela nulla del contenuto.
    v_other.id is not null,
    -- Il contenuto solo a doppio cieco sciolto, cioè dopo aver dichiarato.
    case when v_mine.id is not null then v_other.amount  else null end,
    case when v_mine.id is not null then v_other.method  else null end,
    case when v_mine.id is not null then v_other.paid_at else null end,
    case when v_mine.id is not null and v_other.id is not null
         then v_mine.amount = v_other.amount
         else null end;
end;
$$;

REVOKE ALL ON FUNCTION public.declare_payment(bigint, numeric, text, date) FROM public;
REVOKE ALL ON FUNCTION public.get_payment_declarations(bigint) FROM public;
REVOKE ALL ON FUNCTION public.my_offer_role(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.declare_payment(bigint, numeric, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_declarations(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_offer_role(bigint) TO authenticated;
