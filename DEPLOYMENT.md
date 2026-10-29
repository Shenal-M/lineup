# Lineup: what to set up

Lineup is a single-owner personal app. Its account, password hash, login sessions, follows, settings, observations, release dates, and in-app notifications live in one SQLite database. They do not depend on browser local storage.

## 1. Hosting and durable storage — required for multiple devices

Use one always-on Node.js 24+ web service with HTTPS and a persistent disk, for example a Render web service with a paid persistent disk, or a small VPS with an HTTPS reverse proxy. A free ephemeral web service is not suitable for the SQLite database or dependable scheduled checks.

For Render:

1. Put this source in a private Git repository and create a Node web service from it.
2. Use Node.js 24+, build command `npm ci && npm run build`, and start command `npm start`. This runs the Next.js production server; keep the built `.next` output and installed dependencies on the service.
3. Attach a persistent disk at `/var/data`.
4. Configure the environment below. Render supplies `PORT`; do not hardcode it.
5. On the **first deployment**, protect setup with a temporary secret `SETUP_KEY`. Open Lineup, enter this setup key, and create your owner account. No further accounts can be created.
6. Open the same HTTPS address on each device and sign in with that owner account. Existing follows and settings appear on each device.
7. Schedule backups of the SQLite database, including WAL-safe backups. Test restoration. A persistent disk survives process restarts and deployments; backups protect against disk or account loss.

| Variable | Hosted value | Purpose |
|---|---|---|
| `NODE_VERSION` | `24` | Native TypeScript and SQLite support |
| `HOST` | `0.0.0.0` | Accept requests from the host's proxy |
| `DB_PATH` | `/var/data/lineup.sqlite` | Database on durable storage |
| `COOKIE_SECURE` | `true` | HTTPS-only session cookies |
| `SETUP_KEY` | A long random secret | Protect first account creation on hosted instances |
| `TMDB_TOKEN` | Your TMDB read-access bearer token | Optional until enabling live catalogue data |

Run only one app instance with this SQLite file. If you need several instances or several unrelated users, migrate to PostgreSQL and add account-specific library ownership first. This implementation has one owner, not public multi-user registration.

`APP_TOKEN` is optional server-to-server access and bypasses browser sign-in; leave it unset unless needed. Never put it in public frontend configuration.

## 2. TMDB — required for live catalogue and theatrical dates

Create a TMDB developer account and obtain the **API Read Access Token** at https://www.themoviedb.org/settings/api. Set it as `TMDB_TOKEN` in your host's secrets and restart the service.

This enables live movie/TV search, posters, metadata, season browsing, and regional theatrical imports. Search and import are already implemented. The theatrical importer currently processes the first discovery page of a selected month; pagination and scheduled source refreshing remain to be built.

Keep the token on the server. Before public distribution, complete TMDB's required logo attribution. Do not send this token in chat.

## 3. Streaming premiere dates — next integration

Evaluate Movie of the Night's **Streaming Availability API** at https://docs.movieofthenight.com/. Obtain the key/header configuration for the plan you select.

The adapter is **not implemented yet**, so no streaming credential variable is consumed by the app today. Once implemented, it can supply provider-specific upcoming movie/season premieres. The research reports roughly a 31-day forward window, limited supported services, and no established Sri Lankan coverage. Check current coverage and quotas before purchasing a plan. Dates beyond that coverage need source-backed announcements/manual entry.

TMDB generic digital dates and series air dates are not substitutes for subscription premiere dates. Lineup keeps those meanings separate.

TVmaze has a free, no-key API; its current adapter only stores schedule observations and is not yet part of the scheduled import pipeline. Do not sign up for a paid TV schedule provider for this first build.

## 4. External notifications — optional

In-app alerts already work without another service. For email, create a Resend account at https://resend.com/, verify a sender domain using its DNS records, and obtain an API key and sender address.

The Resend delivery adapter is **not implemented yet**. Planned server configuration will include its key and verified sender; merely adding a key now will not send email. ntfy is an alternative if you prefer phone push. Choose one first; both are unnecessary for the initial rollout.

## Login behavior

The first account adopts this personal instance's existing library. Passwords are salted and hashed with scrypt. Login uses opaque, HTTP-only, SameSite cookies with a 30-day expiry; only hashes of session tokens are stored. Failed logins share a single-owner rate-limit bucket across clients, avoiding reliance on untrusted forwarded IP headers. Sign-out revokes the current session. Changing the password revokes other device sessions.

There is no email verification or email-based forgotten-password reset yet. No third-party authentication service is required. Keep a database backup and use a password manager for the owner account.

## Current deployment status

The app has been migrated to Next.js 16/React 19 and tested locally, including opening existing SQLite records and session cookies without a data reset. No public server, domain, persistent hosted disk, streaming feed account, or notification sender has been provisioned in this session. The login alone does not make a local server reachable from other devices.

## Upgrading from the original Node application

Stop the old service and take a WAL-safe database backup. Keep the same `DB_PATH`, runtime secrets, hostname, and cookie settings. Run `npm ci`, `npm run build`, then `npm start`. No database schema migration or account recreation is required for this conversion; existing-format library and session compatibility are covered by `tests/migration_smoke.py`. Do not deploy the SQLite file into ephemeral build output or use a static export. The API route requires the Node.js runtime.

Locally, Next.js reads `.env.local` and standard environment files. Production hosting secrets are preferred. The importer/worker scripts read `.env.local` if present; hosting environment variables take precedence. Set the production launcher's `HOST`/`PORT` in the shell or dashboard, not only inside a Next.js env file.
