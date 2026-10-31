-- Lineup stores only followed titles; upcoming lists and search come live from TMDB.
-- Removes the sample catalogue and every title (with its dates and history) that is
-- not followed. Safe to re-run: it only ever deletes unfollowed data.

-- Notifications keep the title's name, so they outlive an unfollow.
update public.records n
set body = (n.body::jsonb || jsonb_build_object('titleName', t.body::jsonb->>'name'))::text
from public.records t
where n.kind = 'notifications' and t.kind = 'titles'
  and t.id = n.body::jsonb->>'titleId' and n.body::jsonb->>'titleName' is null;

-- Sample titles are illustrative, so follows of them and their reminders go too.
create temporary table sample_titles on commit drop as
  select id from public.records where kind = 'titles' and body::jsonb->>'demo' = 'true';
delete from public.email_deliveries d using public.outbox o
  where o.id = d.id and o.body::jsonb->>'titleId' in (select id from sample_titles);
delete from public.outbox where body::jsonb->>'titleId' in (select id from sample_titles);
delete from public.records
  where kind in ('subscriptions', 'notifications')
    and body::jsonb->>'titleId' in (select id from sample_titles);

delete from public.records r
where (r.kind = 'titles' and not exists (
         select 1 from public.records s
         where s.kind = 'subscriptions' and s.body::jsonb->>'titleId' = r.id))
   or (r.kind in ('releases', 'observations') and not exists (
         select 1 from public.records s
         where s.kind = 'subscriptions' and s.body::jsonb->>'titleId' = r.body::jsonb->>'titleId'));

-- The bulk import status no longer applies; followed-title checks reuse this row.
delete from public.records where kind = 'health' and id = 'tmdb';
