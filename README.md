# Lineup

A minimal personal movie and TV release tracker: near-black surfaces, white type, lilac actions, and per-channel release notifications.

Next.js 16 (App Router) · React 19 · TypeScript · Supabase PostgreSQL · Resend email.

## Local setup

Requires Node.js 24+ and a Supabase project.

```bash
npm ci
cp .env.example .env        # then fill in DATABASE_URL
npm run db:migrate          # creates the tables in Supabase (safe to re-run)
npm run dev                 # http://127.0.0.1:3000
```

`DATABASE_URL` is the **Transaction pooler** URI from Supabase > Connect (port 6543, user `postgres.PROJECT_REF`), with the database password URL-encoded. TLS is fully verified; Supabase's root CA is bundled in [src/supabase-ca.ts](src/supabase-ca.ts) because Node does not ship it.

On first visit, create the single owner account. Everything (account, sessions, follows, settings, releases, notifications) lives in Supabase, so the same login works from any device pointed at the same database.

Production build: `npm run build && npm start`.

## Configuration

See [.env.example](.env.example). All values are server-only.

| Variable | Use |
|---|---|
| `DATABASE_URL` | **Required.** Supabase transaction-pooler URI |
| `COOKIE_SECURE` | `true` on HTTPS hosts, `false` locally |
| `SETUP_KEY` | Required to create the owner account on an HTTPS host |
| `TMDB_TOKEN` | Optional TMDB read-access token: live search, posters, seasons, theatrical import |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional email reminders |
| `CRON_SECRET` | Bearer secret for `/api/cron/reminders` |
| `APP_TOKEN` | Optional server-to-server token; bypasses login, leave unset unless needed |

Deploying to Vercel, Resend setup and hourly Supabase Cron scheduling: [docs/SUPABASE.md](docs/SUPABASE.md).

## Scripts

```bash
npm run dev                    # development server
npm run build && npm start     # production server
npm run typecheck
npm test                       # unit tests (+ Postgres tests when TEST_DATABASE_URL is set)
npm run db:migrate             # apply supabase/migrations to DATABASE_URL
npm run import -- 2026-11 US   # import a month of TMDB theatrical dates (TMDB_TOKEN required)
npm run worker                 # one reminder/email pass
```

The Postgres suite in [tests/postgres.test.ts](tests/postgres.test.ts) runs only against a disposable local database named `lineup_test` (it truncates tables and refuses remote hosts):

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/lineup_test npm test
```

Create `anon` and `authenticated` roles in that database first to mirror Supabase.

## Features

- Monthly release agenda, poster/list views and theatrical/streaming filters; US/GB/LK markets independent of reminder timezone.
- Search, Following and Settings pages; title popup with poster, synopsis, tags and per-channel date rows.
- Independent bell per streaming service or theatrical release, including dates not yet announced.
- Source-backed manual dates and corrections; material changes create revisions and supersede stale alerts.
- In-app reminders for announcements, changes and 7-day / 1-day / release-day alerts; email via Resend.
- Single owner account: scrypt password hashes, hashed 30-day HttpOnly session cookies, rate-limited sign-in.

## Known limits

- Streaming-premiere feed (e.g. Movie of the Night) is not implemented; add streaming dates manually with a source.
- TMDB theatrical import reads only the first discovery page per month.
- No password-reset email, push notifications or weekly digest.
- Sample titles are illustrative and marked as samples. Sri Lankan dates are never substituted from other markets.
- Complete TMDB logo attribution before public distribution.

## Layout

- `app/` — routes, global styles, `/api/[...path]` and `/api/cron/reminders`.
- `src/components/` — React UI.
- `src/lib/` — API dispatch and the per-process runtime (store + auth).
- `src/postgres-store.ts`, `src/model.ts` — persistence, release semantics and notification outbox.
- `src/auth.ts`, `src/email.ts`, `src/providers.ts` — owner auth, Resend delivery, TMDB adapter.
- `supabase/` — SQL migrations, migrate script and the hourly cron schedule.
- [docs/RESEARCH.md](docs/RESEARCH.md) — original product research.
