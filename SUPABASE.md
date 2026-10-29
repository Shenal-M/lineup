# Vercel + Supabase + email setup

Lineup supports Supabase PostgreSQL for durable serverless storage and Resend for email. It keeps the existing single-owner account/password login; Supabase Auth is not used. No Supabase publishable key, anon key, service-role key, or browser database access is needed.

## 1. Create database tables

In Supabase SQL Editor, run `supabase/migrations/202610290001_lineup.sql`. It is repeatable and does not reset existing tables. RLS is enabled and API-role access is revoked: the backend connects directly as the database owner. Do not grant these tables to browser clients.

In Supabase **Connect**, choose **Transaction pooler** and copy its PostgreSQL URI (typically port 6543, user `postgres.PROJECT_REF`). Replace the password placeholder with the database password, URL-encoded if it contains special characters. Use the provided pooler hostname, not the direct IPv6-only database hostname. Keep TLS verification enabled. If connection verification fails, diagnose trust/hostname rather than disabling TLS.

## 2. Vercel environment variables

Add these in Project Settings > Environment Variables for Production, then redeploy:

| Variable | Value / source |
| --- | --- |
| `DATABASE_URL` | Supabase transaction-pooler PostgreSQL URI, including password |
| `COOKIE_SECURE` | `true` |
| `SETUP_KEY` | A long random secret used once to protect owner-account creation |
| `RESEND_API_KEY` | API key from Resend, with email sending access |
| `EMAIL_FROM` | For example `Lineup <reminders@your-verified-domain.com>` |
| `CRON_SECRET` | A separate long random secret for scheduled requests |
| `TMDB_TOKEN` | Optional: TMDB read-access token for live search and manual theatrical imports |

Generate SETUP_KEY and CRON_SECRET separately with `openssl rand -hex 32`. Do not share credentials in chat, commit them, or use NEXT_PUBLIC_ prefixes. `DB_PATH`, HOST, PORT and APP_TOKEN are unnecessary for Vercel. Do not point preview deployments at the production database; give them an isolated database and no production email credentials.

Use Node.js 24.x in Vercel. Build command: `npm run build`; install: `npm ci`. Set Vercel Function Region to US East if your Supabase project is North Virginia. Open your site, enter SETUP_KEY at first owner creation, and use the email address that should receive reminders. Save your password securely: password-reset email is not implemented. Supabase itself does not send these release emails.

## 3. Configure Resend

Create a Resend account and verify a sender domain's DNS records. A verified sender normally requires a domain you own; free sending quotas do not include purchasing a domain. For initial testing, Resend's testing sender can generally deliver only to the email associated with your Resend account; use that same address for your Lineup owner account. Check current provider restrictions/quotas. Provider acceptance does not guarantee inbox placement; inspect delivery/bounce logs.

## 4. Schedule hourly email delivery for free-tier personal use

Enable **pg_cron** and **pg_net** under Supabase Database > Extensions. In Supabase Vault add:

- `lineup_reminder_url`: `https://YOUR-PRODUCTION-DOMAIN/api/cron/reminders`
- `lineup_cron_secret`: exactly the value of CRON_SECRET in Vercel

Run `supabase/schedule-reminders.sql` in SQL Editor. This calls the protected Vercel endpoint hourly; no Supabase Edge Function or Vercel Cron plan is required. The job creates due in-app notifications and sends up to five pending emails per invocation, to the owner's account email. A five-email batch is appropriate for this personal app; backlogs take subsequent invocations. All emails follow your per-channel bell and reminder rules. Scheduled checks use your configured timezone/hour; delivery may be up to an hour later. Announcements/changes send on the next check.

To verify, add a source-backed release and follow its channel with release-day reminders enabled, using today's date and a reminder hour already reached. Invoke the protected endpoint from a trusted client using the Authorization bearer header, or wait for Cron. An unauthenticated request must return 401. A configured job returns JSON counts `sent`, `failed`, `review`. Inspect `net._http_response` using the query in the SQL file and inspect Resend's delivery logs. Supabase cron runs can report success even if the queued HTTP call fails, so inspect both.

Failed provider requests retry on the next invocation using a stable Resend idempotency key. Concurrent jobs serialize database mutations and suppress duplicate sends. First-attempt timestamps are committed before sending; after 23 hours of uncertain delivery, automatic retries stop to avoid exceeding Resend's 24-hour idempotency window. Inspect `email_deliveries` rows marked `manual_review` against Resend logs before deciding to resend. Notifications made stale by a release revision or unfollow are suppressed. A successful `sent` count means provider acceptance, not confirmed inbox delivery.

The scheduler catches up missed reminder checks for up to seven days after its previous successful check. It does not backfill reminders before a new subscription existed; the initial scheduler run starts from now. Free Supabase projects may pause and all services have quotas: free plans offer no guarantee of timely delivery. Review current limits for Supabase, Vercel and Resend. Check Cron/HTTP and email logs regularly.

Live release-data refresh is separate: TMDB search and manual theatrical import are supported; automatic streaming release discovery and weekly email digests are not implemented. Only dates already stored in Lineup can generate reminders. Sample-title emails are explicitly marked as samples.

## Local development and verification

Without DATABASE_URL, local SQLite remains supported for inbox behavior. Scheduled emails require PostgreSQL. Use `.env.local` for local secrets (ignored by Git). Never test against the production database.

Run `npm run typecheck`, `npm test`, `npm run build`, then the Python API, auth, migration and browser smoke tests documented in README, plus `python tests/cron_smoke.py`. For a disposable local PostgreSQL database named `lineup_test`, create `anon` and `authenticated` roles to simulate Supabase and run:

```sh
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/lineup_test node --test tests/postgres.test.ts
```

This test truncates its local test tables. Its guard rejects remote hosts and other database names. Only this explicit local test path permits a non-TLS PostgreSQL connection. Production always verifies TLS.

Existing SQLite data is not automatically copied to Supabase. Back up the SQLite file and WAL safely before any separate data-migration operation; setting DATABASE_URL selects a new database and does not import an existing account or library. Never delete the old database until migration is verified.
