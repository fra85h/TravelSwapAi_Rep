-- ============================================================
-- Backstop backend per la coerenza delle offerte (Soluzione A).
--
-- Un'offerta ha senso solo verso un annuncio VENDO (un biglietto che
-- esiste davvero): un CERCO è una richiesta, non un bene acquistabile o
-- ricevibile. E uno SCAMBIO richiede un biglietto su ENTRAMBI i lati,
-- quindi anche l'annuncio offerto (from_listing) deve essere un VENDO —
-- non puoi offrire in scambio una tua richiesta (CERCO).
--
-- L'app già nasconde le azioni non valide, ma questo trigger è la difesa
-- a livello di DB: blocca qualunque inserimento incoerente, da qualsiasi
-- client. Estende before_insert_offers_enforce senza cambiarne il resto.
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
        and _norm(o.status) in ('pending','in_review');

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
