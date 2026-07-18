-- ============================================================
-- Aggiunge 'expired' all'enum offer_status.
--
-- Serve al timeout delle proposte pending (vedi la migration
-- successiva, 20260718110001_offers_timeout.sql): una proposta non
-- accettata/rifiutata entro la finestra concessa passa a questo stato
-- invece di restare 'pending' per sempre.
--
-- Isolata nel proprio file: ALTER TYPE ... ADD VALUE non può essere
-- usato nella stessa transazione in cui il nuovo valore viene poi letto
-- o confrontato (limite di Postgres) — stesso motivo per cui
-- 20260711160001_security_hardening.sql tiene i suoi ALTER TYPE da soli
-- in fondo al file, senza altre istruzioni dopo.
-- ============================================================

alter type public.offer_status add value if not exists 'expired';
