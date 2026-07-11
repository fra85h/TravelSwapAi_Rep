# Database Supabase — schema versionato

Lo schema del database vive in `migrations/`, in ordine di applicazione:

| File | Contenuto |
|---|---|
| `20260711160000_init.sql` | Schema completo ricostruito dal backup del progetto originale (enum, 14 tabelle, 6 viste, ~25 funzioni/RPC, trigger, indici, policy RLS) |
| `20260711160001_security_hardening.sql` | Fix di sicurezza: RLS sulle 4 tabelle che ne erano prive, PNR rimosso da `listings` e dalla vista `v_last_minute`, valori enum `expired`/`deleted` mancanti |

Entrambe le migrazioni sono state validate applicandole in sequenza a un PostgreSQL 16 pulito.

## Ripristino su un nuovo progetto (il vecchio è in pausa non riattivabile)

1. **Crea il progetto**: [dashboard Supabase](https://supabase.com/dashboard) → *New project* (stessa organizzazione va bene). Salva la password del database.
2. **Applica le migrazioni**: *SQL Editor* → incolla il contenuto di `20260711160000_init.sql` → *Run*; poi ripeti con `20260711160001_security_hardening.sql`.
   In alternativa con la CLI: `supabase link --project-ref <nuovo-ref>` poi `supabase db push`.
3. **(Facoltativo) Dati vecchi**: il backup scaricato (`db_cluster*.backup.gz`) contiene i dati di prova (59 annunci, 5 profili). Gli account utente (`auth.users`) si recuperano solo col restore completo del backup, non con queste migrazioni — per una beta conviene ripartire con utenti nuovi.
4. **Aggiorna le chiavi** (*Settings → API* del nuovo progetto):
   - App — `travelswap_ai/travelswapai/.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - Server (Render) — variabili d'ambiente: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## Note sullo schema

- `offers.id` è **seriale intero**, non uuid: è il motivo delle RPC `*_any` "tolleranti uuid/int" usate dall'app.
- `listings.start_date` è una colonna **generata** (check_in per hotel, data di depart_at per treni).
- Le tabelle `fb_sessions`, `listing_ai_scores`, `match_snapshots`, `trust_audit` sono a uso esclusivo del server (service role): RLS attiva senza policy.
- Il PNR vive **solo** in `listing_secrets` (RLS attiva, nessuna policy client).
