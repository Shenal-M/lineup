-- Email delivery claims: a job marks an email as being sent (claimed_at, epoch ms) in a
-- short locked transaction and sends it outside any transaction. Idempotent.
alter table public.email_deliveries add column if not exists claimed_at bigint;
