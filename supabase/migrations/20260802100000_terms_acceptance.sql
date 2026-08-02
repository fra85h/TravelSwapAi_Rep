-- ============================================================
-- Accettazione di termini e informativa privacy
--
-- Serve poter dimostrare CHE COSA una persona ha accettato e QUANDO: non
-- basta un flag booleano, perché i documenti cambiano nel tempo e
-- "ha accettato" senza sapere quale versione non prova nulla. Da qui le due
-- colonne, e la versione trattata come testo (non un numero) perché è
-- l'etichetta che compare in cima ai documenti.
--
-- Perché una RPC e non una UPDATE dal client: profiles è scrivibile
-- dall'utente (nome, bio, telefono), quindi senza un percorso dedicato
-- chiunque potrebbe post-datare o retro-datare la propria accettazione con
-- una chiamata diretta a PostgREST. Qui la data la mette il server con now()
-- e non è mai un valore che arriva da fuori.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'Quando l''utente ha accettato termini e privacy. NULL = mai accettati: l''app mostra il passaggio di accettazione prima di far entrare.';
COMMENT ON COLUMN public.profiles.terms_version IS
  'Quale versione dei documenti è stata accettata. Alzandola si richiede una nuova accettazione a tutti.';

-- Registra l'accettazione dell'utente corrente.
-- Idempotente sulla stessa versione: riaccettare non sposta la data, così
-- resta il momento in cui l'utente ha davvero prestato il consenso.
CREATE OR REPLACE FUNCTION public.accept_terms(p_version text)
RETURNS TABLE(terms_accepted_at timestamptz, terms_version text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_version is null or length(trim(p_version)) = 0 then
    raise exception 'Missing terms version';
  end if;

  update public.profiles p
  set terms_accepted_at = now(),
      terms_version     = p_version
  where p.id = v_me
    and (p.terms_version is distinct from p_version);

  -- Nessuna riga in profiles (account creato prima del trigger che la crea,
  -- o profilo mai inizializzato): la si crea, altrimenti l'accettazione non
  -- avrebbe dove essere registrata e l'utente resterebbe bloccato fuori.
  if not exists (select 1 from public.profiles p where p.id = v_me) then
    insert into public.profiles (id, terms_accepted_at, terms_version)
    values (v_me, now(), p_version)
    on conflict (id) do update
      set terms_accepted_at = excluded.terms_accepted_at,
          terms_version     = excluded.terms_version;
  end if;

  return query
    select p.terms_accepted_at, p.terms_version
    from public.profiles p
    where p.id = v_me;
end;
$$;

REVOKE ALL ON FUNCTION public.accept_terms(text) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_terms(text) TO authenticated;
