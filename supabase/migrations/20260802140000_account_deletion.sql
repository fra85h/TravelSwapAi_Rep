-- ============================================================
-- Cancellazione dell'account
--
-- Requisito di legge (diritto alla cancellazione, art. 17 GDPR) e requisito
-- degli store: Apple pretende che un'app che permette di creare un account
-- permetta anche di eliminarlo dall'app stessa.
--
-- PERCHÉ NON SI CANCELLA LA RIGA IN auth.users
--
-- Quasi tutte le tabelle vi puntano con ON DELETE CASCADE: listings,
-- transaction_ratings (sia rater_id sia rated_id), chain_participants,
-- payment_declarations, transactions.seller_id, profiles. E offers punta a
-- listings, sempre in cascata. Eliminando l'utente si porterebbero via:
--
--   * i VOTI CHE HA DATO ad altri, cioè pezzi della reputazione altrui;
--   * gli annunci, e con essi le offerte che li riguardavano, cioè la
--     cronologia di chi ha comprato o scambiato con lui;
--   * il profilo, quindi le valutazioni ricevute resterebbero senza un
--     soggetto a cui riferirsi.
--
-- Sarebbe una cancellazione che danneggia terzi, e non è ciò che il diritto
-- alla cancellazione richiede: il GDPR ammette la conservazione quando serve
-- ad accertare o difendere un diritto (art. 17.3.e), che è esattamente il
-- caso di una transazione conclusa fra due persone.
--
-- COSA SI FA INVECE
--
-- Si cancella tutto ciò che riguarda SOLO l'utente, e si rende anonimo ciò
-- da cui dipendono gli altri. Il risultato è che i dati personali spariscono
-- ma le transazioni altrui restano leggibili, attribuite a "Utente eliminato".
--
-- L'accesso viene chiuso lato server (email sostituita e account bloccato con
-- l'API di amministrazione), non qui: da SQL non si tocca lo schema auth.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.profiles.deleted_at IS
  'Quando l''utente ha chiesto la cancellazione. La riga resta per dare un soggetto alle valutazioni e alle transazioni altrui, ma è priva di dati personali.';

-- ------------------------------------------------------------
-- Cosa impedisce la cancellazione, adesso.
-- Sparire con una transazione in corso lascerebbe la controparte con uno
-- scambio aperto e nessuno con cui concluderlo: prima si chiude o si annulla.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_deletion_blockers(p_user_id uuid)
RETURNS TABLE(open_offers int, open_chains int)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int
       FROM public.offers o
       LEFT JOIN public.listings l ON l.id = o.to_listing_id
      WHERE o.status::text = 'accepted'
        AND (o.proposer_id = p_user_id OR l.user_id = p_user_id)),
    (SELECT count(*)::int
       FROM public.chain_participants cp
       JOIN public.chain_proposals c ON c.id = cp.chain_id
      WHERE cp.user_id = p_user_id
        AND lower(c.status::text) NOT IN ('completed', 'failed', 'expired', 'cancelled'));
$$;

-- ------------------------------------------------------------
-- Rende anonimo l'account e cancella i dati che riguardano solo lui.
-- Chiamabile SOLO dal server (service_role): l'ordine delle operazioni e la
-- chiusura dell'accesso vanno governati insieme, e un client non deve poter
-- eseguire metà procedura.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
RETURNS TABLE(listings_removed int, listings_kept int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_blk_offers int;
  v_blk_chains int;
  v_removed int := 0;
  v_kept int := 0;
begin
  if p_user_id is null then raise exception 'Missing user'; end if;

  select b.open_offers, b.open_chains into v_blk_offers, v_blk_chains
  from public.account_deletion_blockers(p_user_id) b;

  if coalesce(v_blk_offers, 0) > 0 then
    raise exception 'Account has % transaction(s) in progress', v_blk_offers
      using errcode = 'P0001';
  end if;
  if coalesce(v_blk_chains, 0) > 0 then
    raise exception 'Account has % chain swap(s) in progress', v_blk_chains
      using errcode = 'P0001';
  end if;

  -- 1) Dati che riguardano soltanto lui: si cancellano davvero.
  delete from public.listing_secrets s
   where s.listing_id in (select l.id from public.listings l where l.user_id = p_user_id);
  delete from public.listing_images i
   where i.listing_id in (select l.id from public.listings l where l.user_id = p_user_id);
  delete from public.saved_listings   where user_id = p_user_id;
  delete from public.saved_searches   where user_id = p_user_id;
  delete from public.match_snapshots  where user_id = p_user_id;
  delete from public.matches          where user_id = p_user_id;
  delete from public.ai_import_logs   where user_id = p_user_id;
  delete from public.trust_audit      where user_id = p_user_id;
  delete from public.fb_account_links where user_id = p_user_id;
  delete from public.fb_link_codes    where user_id = p_user_id;

  -- 2) Annunci. Quelli che nessuno ha mai toccato spariscono del tutto.
  --    Quelli con una proposta alle spalle NO: offers vi punta in cascata, e
  --    cancellarli porterebbe via la cronologia della controparte. Restano
  --    come 'deleted', cioè invisibili e non riattivabili.
  with orfani as (
    delete from public.listings l
     where l.user_id = p_user_id
       and not exists (select 1 from public.offers o
                        where o.to_listing_id = l.id or o.from_listing_id = l.id)
    returning 1
  )
  select count(*)::int into v_removed from orfani;

  update public.listings
     set status = 'deleted'
   where user_id = p_user_id
     and status::text <> 'deleted';
  get diagnostics v_kept = row_count;

  -- 3) Profilo: via i dati personali, resta il guscio.
  --    full_name valorizzato e non svuotato perché è ciò che le schermate
  --    mostrano accanto a valutazioni e transazioni: lasciarlo vuoto darebbe
  --    righe senza nome invece di dire chiaramente cosa è successo.
  update public.profiles
     set full_name  = 'Utente eliminato',
         username   = null,
         email      = null,
         phone      = null,
         avatar_url = null,
         bio        = null,
         prefs      = '{}'::jsonb,
         deleted_at = now()
   where id = p_user_id;

  return query select v_removed, v_kept;
end;
$$;

REVOKE ALL ON FUNCTION public.anonymize_account(uuid) FROM public;
REVOKE ALL ON FUNCTION public.account_deletion_blockers(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.account_deletion_blockers(uuid) TO authenticated;
-- anonymize_account resta senza GRANT: la esegue solo il service_role, che
-- scavalca i permessi. Nessun client può eseguirla direttamente.
