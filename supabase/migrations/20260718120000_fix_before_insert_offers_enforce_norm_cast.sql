-- ============================================================
-- Fix: "Proponi scambio" falliva con
--   ERROR: function _norm(offer_status) does not exist
--
-- Causa: before_insert_offers_enforce() era già stato corretto in
-- 20260711160004_fix_offer_status_norm_cast.sql (_norm(o.status::text)),
-- ma 20260717120000_offers_require_vendo.sql ha riscritto la funzione
-- per aggiungere il controllo VENDO/CERCO e ha perso il cast, tornando
-- a _norm(o.status) — o.status è l'ENUM public.offer_status, non text,
-- e _norm(s text) non ha un overload per l'enum. Il trigger
-- trg_before_insert_offers_enforce gira su OGNI insert in offers: la
-- select count(*) con _norm(o.status) sta dentro il ramo
-- "_norm(new.type) = 'swap'" (limite di 2 proposte swap attive), quindi
-- rompeva SOLO le proposte di scambio (from_listing_id valorizzato), mai
-- gli acquisti (from_listing_id null) — coerente col bug segnalato solo
-- su "Proponi scambio".
--
-- Stessa funzione di 20260717120000_offers_require_vendo.sql, unica
-- modifica: o.status -> o.status::text alla riga del conteggio.
-- ============================================================

CREATE OR REPLACE FUNCTION public.before_insert_offers_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  st_to text;
  cv_to text;
  st_from text;
  cv_from text;
  cnt int;
begin
  select status, cerco_vendo into st_to, cv_to
  from public.listings where id = new.to_listing_id;
  if st_to is null then
    raise exception 'Listing target inesistente';
  end if;
  if st_to <> 'active' then
    raise exception 'Puoi proporre solo verso annunci attivi';
  end if;
  -- Solo verso un VENDO: un CERCO è una richiesta, non si acquista/scambia.
  if upper(coalesce(cv_to, 'VENDO')) = 'CERCO' then
    raise exception 'Non puoi fare un''offerta su un annuncio di ricerca (CERCO)';
  end if;

  if new.from_listing_id is not null then
    select status, cerco_vendo into st_from, cv_from
    from public.listings where id = new.from_listing_id;
    if st_from is null then
      raise exception 'La tua listing (from) non esiste';
    end if;
    if st_from <> 'active' then
      raise exception 'La tua listing deve essere attiva per inviare proposte';
    end if;

    if _norm(new.type) = 'swap' then
      -- Scambio: puoi offrire solo un TUO biglietto (VENDO), non un CERCO.
      if upper(coalesce(cv_from, 'VENDO')) = 'CERCO' then
        raise exception 'In uno scambio puoi offrire solo un tuo annuncio in vendita (VENDO)';
      end if;

      select count(*) into cnt
      from public.offers o
      where o.from_listing_id = new.from_listing_id
        and _norm(o.type) = 'swap'
        and _norm(o.status::text) in ('pending','in_review');

      if cnt >= 2 then
        raise exception 'Hai già 2 proposte attive da questa listing';
      end if;
    end if;
  end if;

  -- normalizza default status
  if new.status is null then new.status := 'pending'; end if;

  return new;
end;
$$;
