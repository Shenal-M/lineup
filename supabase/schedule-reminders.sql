-- Enable pg_cron and pg_net in Supabase Database > Extensions first.
-- In Supabase Vault, create these two secrets before running this SQL:
-- lineup_reminder_url = https://YOUR-PRODUCTION-DOMAIN/api/cron/reminders
-- lineup_cron_secret = the SAME random value as CRON_SECRET in Vercel.
-- Keep values in Vault, never in committed SQL or chat.
-- Re-running this script replaces only Lineup's own schedule.
do $$ begin
 if exists(select 1 from cron.job where jobname='lineup-hourly-reminders') then
  perform cron.unschedule('lineup-hourly-reminders');
 end if;
end $$;
select cron.schedule('lineup-hourly-reminders','0 * * * *',$job$
 select net.http_get(
  url := (select decrypted_secret from vault.decrypted_secrets where name='lineup_reminder_url'),
  headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='lineup_cron_secret')),
  timeout_milliseconds := 60000
 );
$job$);
-- Cron success means the HTTP request was queued, NOT that emails were sent.
-- Check recent HTTP responses (expect 200) and Vercel function logs:
-- select id,status_code,timed_out,error_msg,created from net._http_response order by created desc limit 20;
-- Verify actual delivery in Resend's email logs, including bounces/spam.
