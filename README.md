# Lineup

A minimal personal movie and TV release tracker: near-black surfaces, white type, lilac actions, and channel-specific release notifications.

## Vercel deployment with Supabase and email

See [SUPABASE.md](SUPABASE.md) for database migration SQL, Vercel environment variables, Resend sender setup, and hourly Supabase Cron scheduling. Set DATABASE_URL to use PostgreSQL; local SQLite is the fallback for development. Email notifications are implemented for the PostgreSQL workflow.

## Start

Requires Node.js 24+. Lineup now uses Next.js 16 App Router, React 19, and TypeScript. The server runs in the Node.js runtime with durable SQLite storage.

```bash
npm ci
npm run dev
```

For production:

```bash
npm run build
npm start
```

Open http://localhost:3000 on the machine running the app. On first use, create the single owner account. Existing library data stays with that account. Subsequent visits require sign-in. The app stores account credentials, sessions, follows, settings, release history and notifications in SQLite; browser storage is not the source of truth.

For access from other devices, deploy one HTTPS instance with a persistent disk and use that same URL everywhere. See [the deployment and API setup guide](DEPLOYMENT.md). No public instance has been deployed in this session.

## Features

- Monthly release agenda, poster/list views and theatrical/streaming filters.
- Search, Following and Settings, with US/GB/LK market selection independent from reminder timezone.
- Visual title popup with poster, title, synopsis, genre tags and channel/date rows.
- Independent bell toggles for each streaming service or theatrical release, including unknown dates. Turning off one channel preserves others.
- Notification rules and source/date corrections under expandable sections.
- First-run owner setup; email/password sign-in; 30-day HTTP-only session cookies; sign-out and password change. Passwords use salted scrypt; session tokens are stored only as hashes. Failed sign-ins are rate-limited.
- Durable follows, observations, manual corrections, material release revisions, notification deduplication and supersession of stale queued alerts.
- In-app reminders for date announcements/changes and optional 7-day, 1-day and release-day alerts. Checks run on state requests and through the worker or protected scheduled endpoint.
- Server-side TMDB integration for live title search, posters, metadata, series seasons, episodes and regional theatrical import. Each season is a distinct follow target. Original air dates do not automatically become regional streaming premieres.
- No playback or provider storefront links.

## Configuration

Copy [.env.example](.env.example) to `.env.local` for local development, or configure secrets in your hosting environment. Next.js loads its standard environment files; the CLI worker/import scripts also read `.env.local` if present. Set `HOST`/`PORT` for the production launcher in your shell or host dashboard. Never change an existing `DB_PATH` without moving/backing up its database.

| Variable | Default / use |
|---|---|
| `HOST` | `127.0.0.1`; hosted services use `0.0.0.0` |
| `PORT` | `3000`; use your host's injected value |
| `DB_PATH` | `data/reel.sqlite`; use an absolute path on durable storage in production |
| `COOKIE_SECURE` | Set `true` for hosted HTTPS; leave false for local HTTP |
| `SETUP_KEY` | Required to protect first owner setup when hosted with secure cookies |
| `TMDB_TOKEN` | Optional TMDB API Read Access Token for live catalogue/theatrical data |
| `APP_TOKEN` | Optional privileged server-to-server API token; leave unset unless needed |

Sample titles, dates and provider associations are illustrative, not verified. Sample rows are explicitly marked. Initial browsing opens November 2026 to match the research. Live credentials were not supplied, so real provider responses remain unverified.

## Remaining integrations and limits

- Movie of the Night streaming-premiere feed is not implemented yet. Add streaming dates with source-backed announcements for now.
- Email delivery is implemented with PostgreSQL, Resend, and scheduled requests; see SUPABASE.md. Phone push and weekly digests are not implemented.
- Theatrical import currently handles the first discovery page per month. Pagination and automatic source-refresh scheduling remain to be implemented.
- A TVmaze adapter stores schedule observations only; market/offer verification and automatic scheduling are unfinished. Published use requires CC BY-SA attribution.
- The reminder worker or Supabase Cron must run. PostgreSQL catches up checks for up to seven days; local SQLite checks only the current day. Persistent announcement/change jobs remain queued.
- No email verification or forgotten-password email flow. This is one owner's library, not multi-user registration.
- Use one process/instance with durable SQLite storage and backups. Do not place the database on an ephemeral filesystem. Multiple instances need a shared database migration.
- Sri Lankan dates are unknown unless sourced locally. Selecting a market never substitutes another country's release date.
- Complete TMDB official logo attribution before public distribution.

```bash
npm run import -- 2026-11 US   # TMDB_TOKEN required
npm run worker                # one reminder/outbox pass
```

## Checks

```bash
npm run typecheck
npm run build
npm test
python tests/api_smoke.py
python tests/auth_smoke.py
python tests/ui_smoke.py
python tests/migration_smoke.py
```

Build the production app before running the Python integration checks; they launch isolated `next start` instances.

The eight behavior tests cover event matching, date-only/Colombo timing, unknown-date follows, revisions, corrections, deduplication and independent service follows. HTTP tests cover protected routes, source editing, preferences and channel subscriptions. Authentication tests verify two-client persistence, server restarts, session revocation and rate limiting. Browser tests use Playwright and an installed Chromium to check sign-up/sign-in, cross-client follow persistence, popup actions, mobile sizing and sign-out. They use isolated temporary databases, not the owner's library. Browser dependencies are only needed to run the browser checks. The migration test verifies an existing-format library and session are accepted without database/schema reset.

## Source

- `app/`: App Router pages, global styles, and Node.js API route handler.
- `src/components/`: typed React screens, login, title popup, channel controls, and forms.
- `src/lib/api.ts`, `src/lib/runtime.ts`: API dispatch and the singleton SQLite/auth/reminder runtime.
- `src/auth.ts`: owner account, hashed credentials, cookie sessions and rate limits.
- `src/model.ts`, `src/store.ts`: release semantics, SQLite persistence and outbox.
- `scripts/start.mjs`: production Next.js launcher respecting `HOST` and `PORT`.
- `src/providers.ts`: TMDB adapter and TVmaze observation scaffold.
- `src/seed.ts`: illustrative catalogue.
- `tests/`: behavior, API, authentication and browser checks.
- [RESEARCH.md](RESEARCH.md): original product research.

The Next.js migration preserves the existing database filename, owner/session tables, release semantics and notification behavior. The legacy static UI and custom HTTP server have been removed. Production hosting still requires one always-on Node.js instance with a persistent disk; this SQLite build is not suitable for ephemeral serverless filesystems. No Site or public deployment has been provisioned.

See [HANDOFF.md](HANDOFF.md) for product decisions and remaining integrations.
