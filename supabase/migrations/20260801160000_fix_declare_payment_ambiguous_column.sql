-- ============================================================
-- Fix: declare_payment falliva con
--   column reference "offer_id" is ambiguous
--
-- Causa. La funzione dichiara RETURNS TABLE(offer_id bigint, role text,
-- amount numeric, currency text, method text, paid_at date): quei nomi
-- diventano variabili OUT in scope per tutto il corpo, e coincidono con i
-- nomi delle colonne di payment_declarations. Finché ogni riferimento è
-- qualificato (d.offer_id) non c'è problema, ma la clausola di inferenza
-- ON CONFLICT (offer_id, user_id) è un contesto in cui la qualificazione
-- non è ammessa: lì plpgsql non sa se "offer_id" sia la colonna o la
-- variabile OUT, e alza l'errore.
--
-- Sfuggito ai test perché la logica vive tutta nella RPC: i test lato client
-- (paymentDeclarations.test.js) sostituiscono il client Supabase con un mock,
-- quindi verificano il contratto — parametri inviati, errori propagati — ma
-- non eseguono una riga di SQL. È lo stesso limite già dichiarato per
-- rate_transaction.test.js. L'errore è comunque arrivato all'utente invece di
-- essere inghiottito, che è il comportamento voluto.
--
-- Fix. #variable_conflict use_column: davanti a un'ambiguità, plpgsql sceglie
-- la colonna. È corretto qui perché le variabili OUT non vengono MAI lette nel
-- corpo — servono solo a dare un nome alle colonne del risultato — mentre i
-- parametri di ingresso (p_offer_id, p_amount, p_method, p_paid_at) e le
-- variabili locali (v_me, v_offer, v_role) hanno nomi che non coincidono con
-- alcuna colonna, quindi restano risolti come variabili.
--
-- Parte dalla versione di 20260801120000 (l'unica esistente) e ne cambia solo
-- la direttiva iniziale: firma e comportamento restano identici.
--
-- Verificato che lo stesso schema non si ripeta altrove: get_payment_declarations
-- ha nomi OUT che non coincidono con nessuna colonna (my_role, mine_*, other_*),
-- e rate_transaction (20260727120000) qualifica ogni riferimento e non usa
-- ON CONFLICT.
-- ============================================================

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
#variable_conflict use_column
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
  -- inferiore è la creazione dell'offerta: prima non c'era niente da pagare.
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
