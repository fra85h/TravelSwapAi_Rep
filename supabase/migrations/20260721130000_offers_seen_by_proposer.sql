-- Notifica in-app (fase 1, senza push): chi propone un'offerta (buy o swap)
-- non veniva mai avvisato quando l'altra parte accetta o rifiuta — il flusso
-- si fermava lì, l'unico modo per scoprirlo era riaprire Attività a mano e
-- ricontrollare. seen_by_proposer traccia se il proponente ha già visto
-- l'esito; il trigger la azzera automaticamente quando l'offerta si risolve.
--
-- Non è una tabella notifications separata: si appoggia alla stessa offerta
-- già esistente, riusando l'infrastruttura di Attività/ActivityContext già
-- presente (toDoCount + tabBarBadge) invece di introdurne una nuova.
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS seen_by_proposer boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.mark_offer_unseen_on_resolution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    new.seen_by_proposer := false;
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_offers_mark_unseen ON public.offers;
CREATE TRIGGER trg_offers_mark_unseen
  BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.mark_offer_unseen_on_resolution();

-- Il proponente segna come "viste" le proprie offerte risolte. SECURITY
-- DEFINER perché la RLS del proponente (offers_update_only_proposer_cancel)
-- permette di aggiornare solo offerte ancora 'pending' verso 'cancelled':
-- qui invece serve toccare offerte già 'accepted'/'declined', ma SOLO le
-- proprie — il filtro proposer_id = auth.uid() dentro la funzione stessa
-- impedisce di marcare offerte di altri.
CREATE OR REPLACE FUNCTION public.mark_my_resolved_offers_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.offers
     SET seen_by_proposer = true
   WHERE proposer_id = auth.uid()
     AND seen_by_proposer = false;
$$;

GRANT EXECUTE ON FUNCTION public.mark_my_resolved_offers_seen() TO authenticated;

-- list_outgoing_offers_any deve esporre anche seen_by_proposer al client
-- (Attività ne ha bisogno per la sezione "Esito delle tue proposte" e per il
-- numeretto sul tab). Cambia le colonne di ritorno: DROP+CREATE necessario,
-- CREATE OR REPLACE non lo permette (stesso vincolo già documentato in
-- 20260718110001_offers_timeout.sql). Basata sulla versione più recente di
-- quella funzione (nessuna migration successiva la tocca).
DROP FUNCTION IF EXISTS public.list_outgoing_offers_any();
CREATE FUNCTION public.list_outgoing_offers_any() RETURNS TABLE(id text, type text, status text, message text, amount numeric, currency text, created_at timestamp with time zone, updated_at timestamp with time zone, expires_at timestamp with time zone, to_listing_id text, from_listing_id text, to_listing_title text, from_listing_title text, seen_by_proposer boolean)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  update public.offers o
     set status = 'expired'
   where o.status = 'pending'
     and o.expires_at < now()
     and o.proposer_id = auth.uid();

  select
    o.id::text,
    o.type,
    o.status,
    o.message,
    o.amount,
    o.currency,
    o.created_at,
    o.updated_at,
    o.expires_at,
    o.to_listing_id::text,
    o.from_listing_id::text,
    tl.title as to_listing_title,
    fl.title as from_listing_title,
    o.seen_by_proposer
  from public.offers o
  left join public.listings tl on tl.id::text = o.to_listing_id::text
  left join public.listings fl on fl.id::text = o.from_listing_id::text
  where o.proposer_id = auth.uid()
  order by o.created_at desc;
$$;
