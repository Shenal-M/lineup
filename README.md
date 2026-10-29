# Lineup

A minimal personal movie and TV release tracker: near-black surfaces, white type, lilac actions, and channel-specific release notifications.

## Start

Requires Node.js 24+. No package installation is needed.

```bash
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
- In-app reminders for date announcements/changes and optional 7-day, 1-day and release-day alerts. The server checks every minute and on state requests.
- Server-side TMDB integration for live title search, posters, metadata, series seasons, episodes and regional theatrical import. Each season is a distinct follow target. Original air dates do not automatically become regional streaming premieres.
- No playback or provider storefront links.

## Configuration

Copy the values you need from [.env.example](.env.example) to your hosting secrets or shell environment. The server does not automatically load `.env` files.

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
- Email/phone delivery and weekly digests are not implemented. The inbox works; a Resend key alone will not send email yet.
- Theatrical import currently handles the first discovery page per month. Pagination and automatic source-refresh scheduling remain to be implemented.
- A TVmaze adapter stores schedule observations only; market/offer verification and automatic scheduling are unfinished. Published use requires CC BY-SA attribution.
- The reminder worker must run. Missed scheduled reminder days during downtime are not backfilled. Persistent announcement/change jobs remain queued.
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
npm test
python tests/api_smoke.py
python tests/auth_smoke.py
python tests/ui_smoke.py
```

The eight behavior tests cover event matching, date-only/Colombo timing, unknown-date follows, revisions, corrections, deduplication and independent service follows. HTTP tests cover protected routes, source editing, preferences and channel subscriptions. Authentication tests verify two-client persistence, server restarts, session revocation and rate limiting. Browser tests use Playwright and an installed Chromium to check sign-up/sign-in, cross-client follow persistence, popup actions, mobile sizing and sign-out. They use isolated temporary databases, not the owner's library. Browser dependencies are only needed to run the browser checks.

## Source

- `public/`: responsive UI and login screens.
- `src/auth.ts`: owner account, hashed credentials, cookie sessions and rate limits.
- `src/model.ts`, `src/store.ts`: release semantics, SQLite persistence and outbox.
- `src/server.ts`: API and static server.
- `src/providers.ts`: TMDB adapter and TVmaze observation scaffold.
- `src/seed.ts`: illustrative catalogue.
- `tests/`: behavior, API, authentication and browser checks.
- [RESEARCH.md](RESEARCH.md): original product research.

Sites publishing helpers were absent from the workspace. This build is a local Node application, not a published Site. The research's provider/event/subscription separation is retained while using native TypeScript and SQLite to avoid dependency downloads.
