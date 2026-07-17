-- ============================================================
-- Fix: "Proponi scambio" diceva sempre "non hai annunci in vendita",
-- anche a chi aveva un VENDO attivo.
--
-- list_my_active_listings() (usata da OfferFlow.js per popolare la scelta
-- del proprio annuncio da offrire in scambio) non restituiva mai la colonna
-- cerco_vendo. Il client filtra i risultati con
-- `x.cerco_vendo?.toUpperCase() === "VENDO"`: senza quella colonna il
-- filtro scartava SEMPRE tutti gli annunci (undefined non è mai "VENDO"),
-- quindi la lista risultava vuota per chiunque, indipendentemente da cosa
-- avesse davvero pubblicato.
--
-- Aggiunta anche route_to: lo stesso schermo mostra "Da → A" per i treni
-- (fmtMeta in OfferFlow.js), ma senza route_to la meta-info mostrava solo
-- la partenza.
-- ============================================================

DROP FUNCTION IF EXISTS public.list_my_active_listings();

CREATE FUNCTION public.list_my_active_listings() RETURNS TABLE(
  id text,
  title text,
  type text,
  location text,
  route_from text,
  route_to text,
  cerco_vendo text,
  status text,
  created_at timestamp with time zone
)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  select
    l.id::text, l.title, l.type, l.location, l.route_from, l.route_to, l.cerco_vendo, l.status, l.created_at
  from public.listings l
  where l.user_id = auth.uid()
    and l.status = 'active'
  order by l.created_at desc;
$$;
