# Lineup — session handoff

Prepared 29 October 2026 (Asia/Colombo). Read this, [README.md](README.md), [DEPLOYMENT.md](DEPLOYMENT.md), and then [RESEARCH.md](RESEARCH.md) before continuing. This preserves decisions from the original conversation; the new session will not automatically receive that conversation.

## Product and user intent

Shenal Mendis wants a simple, modern, minimal, intuitive personal movie and TV release tracker inspired by Releases.com. Its purpose is to browse upcoming releases and follow the particular release channels that matter to him, with reliable reminders.

Explicit requirements from the conversation:

- App name: **Lineup**. Earlier working name: Reel; do not restore that branding.
- Background: very dark near-black, not pure black. White text. One primary color for buttons and other actions, with additional accent colors used sparingly.
- The implemented primary color is lilac; this was an implementation choice consistent with that brief, not a separately mandated brand color.
- Keep the interface capable without making it busy. The default view is a compact monthly agenda; poster view is optional.
- Title details must primarily show **title, poster, description, tags, and release dates by channel**, with an independent notification control for each channel. The old text-heavy form was rejected.
- Put sources, date corrections, and detailed reminder preferences under expandable sections rather than dominating the popup.
- Login is required so the owner can recover the same data across browser sessions and devices. Persist data on the server, not just in browser storage.
- Explain what hosting, APIs, and notification services the user needs to set up; the existing guide documents this.

Research scope, accepted as the build basis:

- Core: theatrical movie releases, subscription-streaming movie/TV premieres, search, season browsing, monthly browsing, Following, and notifications.
- Follow a category or selected streaming service even before a date is known. Any-service and selected-service follows are supported.
- Exclude playback/storefront links, Watch Now buttons, and JustWatch widgets.
- Transactional rental/purchase and generic physical dates are optional. Exact DVD/Blu-ray/4K editions are deferred.
- Default release market is US. Reminder timezone is independently Asia/Colombo. Neither implies confirmed Sri Lankan release availability.

## Repository and session status

- Canonical repository: https://github.com/Shenal-M/lineup
- Branch: `main`.
- Implementation baseline before this handoff: `7201ecc794f7f8eeaed954095400ea0a1c009f57`.
- The repository was **public** when created by the user and accessed in this session. Its visibility was not changed.
- The original workspace checkout is `/workspace/reel`, with `origin` set to the URL above and `main` tracking `origin/main`. A new environment may use a different checkout path.
- Source, tests, research, and setup docs are on GitHub. Credentials, the runtime database, and generated preview screenshots are excluded.
- GitHub connector access to this repo was confirmed with push permission. The connector performed the remote writes; a regular Git fetch then synchronized the local checkout.
- This session could configure the workspace remote, but had no tool to change Codex's session-level repository picker. The user is starting a repository-backed session to continue with context.

## What is implemented

### Application

- TypeScript on Node.js 24+, using native TypeScript execution, the built-in HTTP server, and native SQLite. No application dependency installation is needed.
- Plain browser HTML/CSS/JavaScript; no frontend framework or build step.
- Upcoming, Search, Following, and Settings. List/poster views, month navigation, category filters, and explicit US/GB/LK markets.
- Title popup with large poster, description, genre/year/media tags, channel/date rows, and bell buttons. Extra unsourced streaming channels can be expanded and followed before their dates are announced.
- Independent channel follows: following Netflix and Apple TV for one title can coexist, and removing one preserves the other. Each season can be a distinct follow target.
- Source-backed manual date additions and edits. Date precision, status, provenance, revisions, and observations remain separate. Imports preserve manual corrections.
- In-app notification inbox and durable, deduplicated outbox. Pending notifications for old event revisions are superseded. Scheduled checks run every minute while the server runs and on state requests.

### Authentication and persistence

- **One owner account for one personal library**, not public multi-user registration. This is the current implementation choice, based on the personal-use research.
- First-run account setup adopts the existing instance's library. Further account creation is rejected.
- Email/password sign-in, salted scrypt password hashes, 30-day HttpOnly/SameSite cookie sessions, hashed session tokens in SQLite, failed-login rate limiting, sign-out, and password change.
- Password change revokes other sessions. Sign-out revokes the current session.
- Hosted first-run setup is protected by `SETUP_KEY`; `COOKIE_SECURE=true` requires a setup key before creating the initial owner account. Local HTTP setup can work without one.
- Follows, settings, releases, notifications, account and sessions survive restarts when the database is kept on durable storage.
- No email verification or forgotten-password email flow yet.

### Data adapters

- TMDB live movie/TV search, posters, metadata, TV seasons/episodes, and regional theatrical import are implemented behind server-side `TMDB_TOKEN`.
- The importer hydrates country-specific release entries and uses types 2/3 for theatrical events.
- TVmaze has an observation-only schedule adapter scaffold. It does not promote unverified schedules into confirmed subscription premieres and is not automatically scheduled.
- Streaming Availability API / Movie of the Night integration and external notification delivery are **not implemented**.

## Important limits — do not claim these are complete

- **No public deployment exists.** The original app was run locally on port 3000. A local process or screenshot is not a hosted cross-device application.
- Cross-device behavior was tested with independent clients against the same local server. Real phone/desktop access requires one reachable HTTPS server and durable storage.
- Live provider credentials have not been supplied. Real upstream calls and catalogue coverage remain unverified.
- Seed titles, dates, provider associations, and poster artwork are illustrative. They are labelled as samples and must not be represented as verified announcements.
- Initial browsing is hardcoded to November 2026 for the research preview. Replace that with an appropriate current-month default when preparing live use, while keeping sample browsing useful.
- TMDB theatrical import handles only the first discovery page per selected month. Pagination, quota-aware refresh scheduling, and full coverage are unfinished.
- No automatic streaming feed, email/push delivery, weekly digest, or availability-first-observed adapter. Merely configuring a Resend or streaming key will not enable an unimplemented integration.
- Scheduled reminder days missed during downtime are not backfilled. Durable announcement/change jobs do persist.
- No validated Sri Lankan provider coverage. Never silently substitute US/UK dates for Sri Lanka.
- TMDB official logo attribution remains to be completed before public distribution. TVmaze published use requires its attribution/license handling.
- Only one running app instance should use this local SQLite file. Several instances or unrelated users require a shared database/ownership migration.

## Semantic constraints to preserve

1. Theatrical, subscription streaming, transactional digital, and physical releases are distinct. A rental or generic digital date must not trigger a subscription-streaming alert.
2. Title, season, release market, service, offer type, and event kind must remain distinguishable. Season 1 availability does not establish Season 2 availability.
3. Exact dates, month/quarter/year windows, and TBA are distinct. A range boundary is not a release day.
4. Date-only releases stay on the selected market calendar day. Notification time follows the configured timezone separately.
5. A subscription must match events created later, not only existing dated rows.
6. Only material release changes should advance revisions and trigger schedule-change alerts; a synopsis/poster update must not do so.
7. An empty or failed import must preserve existing data, not cancel releases. Keep manual corrections auditable.
8. A scheduled-today message is not a verified available-now message.
9. Keep provider credentials server-side. Never commit real `.env` files, database files, account credentials, or session cookies.

## Setup the user still needs

Detailed steps and variable names are in [DEPLOYMENT.md](DEPLOYMENT.md).

- **Always-on hosting with HTTPS and a persistent disk:** the guide suggests a Render Node web service with durable storage, or a VPS. No provider was provisioned or selected by the user yet.
- **TMDB API Read Access Token:** enables the implemented live catalogue/theatrical features.
- **Streaming Availability API key/plan:** evaluate service, market, season and horizon coverage before purchase; build the adapter before expecting dates. The research reports approximately a 31-day upcoming window and no established Sri Lankan support; re-check current provider documentation.
- **Optional Resend:** API key and verified sender domain for email after implementing delivery. ntfy is an alternative for phone push. In-app notifications require neither.
- No separate authentication provider or database service is necessary for the current single-owner SQLite architecture.

Environment variables currently consumed:

- `HOST` (default `127.0.0.1`), `PORT` (default `3000`).
- `DB_PATH` (default `data/reel.sqlite`; legacy filename, despite current Lineup branding).
- `COOKIE_SECURE`, `SETUP_KEY`.
- `TMDB_TOKEN`.
- Optional privileged `APP_TOKEN` for server-to-server access; it bypasses browser login. Leave unset unless needed and never expose in frontend config.

The app does **not** automatically load `.env` files. Configure shell/runtime secrets, or deliberately add an environment-loading mechanism. Do not rename/move an existing database without a migration, or the owner may appear to lose their library.

## How to run and verify

```bash
npm start
npm test
python tests/api_smoke.py
python tests/auth_smoke.py
python tests/ui_smoke.py
```

- `npm test`: eight passing behavioral tests for matching, timing, revisions, deduplication, corrections, and independent channel subscriptions.
- HTTP integration: protected APIs, search/details, follows, edits, source validation, notifications, settings, and independent channel IDs.
- Authentication integration: two clients share data; sessions and data survive process restart; setup key/CSRF checks; password change, logout, and rate limiting.
- Browser integration: first-run setup/login, independent channel toggles, persistence after reload and across two browser contexts, poster/date popup, mobile sizing without horizontal overflow, and sign-out. No browser JavaScript errors were observed.
- Integration tests use isolated temporary databases. They must not mutate the owner's actual library.
- Python browser tests require Playwright and Chromium; they are not application runtime dependencies. The original environment had `/usr/bin/chromium` installed. Do not assume a fresh Codex environment does.
- `npm run import -- YYYY-MM US` imports one theatrical month when TMDB credentials exist.
- `npm run worker` runs one reminder/outbox pass.

## Latest architecture discussion

After requesting this handoff, the user asked whether migrating to Next.js would be too much. The recommendation given was that Next.js is a reasonable next step while the app is small: React components would simplify the title popup, channel controls, forms and authentication states compared with the current HTML-string UI. The migration has **not been approved or performed**. Do not assume the question itself authorizes a rewrite.

Next.js does not itself provide cross-device persistence, streaming dates or notification delivery. Preserve the release semantics, source history, channel subscriptions and tests during any approved migration. An always-on deployment can retain durable SQLite; serverless deployment requires compatible persistent storage, typically a managed database. A maintained authentication solution should be evaluated instead of blindly carrying over custom authentication. Keep the chosen hosting model and data migration explicit.

## Suggested next work

These are recommendations, not claims that the user approved a specific hosting vendor or paid API plan:

1. Inspect current repo state and this handoff; continue the existing implementation rather than rebuilding it.
2. Complete streaming-premiere acquisition with verified provider/market/season matching, future-event subscriptions, pagination and quota handling.
3. Complete theatrical pagination and scheduled source refresh; expose coverage/staleness honestly.
4. Implement one external notification transport with durable retries, revision rechecks and delivery deduplication.
5. Deploy one owner-protected HTTPS instance with persistent storage and tested backups, then test on the user's actual devices.
6. Replace the pinned preview month, distinguish sample/live content clearly, and finish provider attribution and any launch-critical auth/recovery work.

If the user steers the work differently, follow the latest instruction. They prefer concrete progress and concise updates rather than repeated confirmation requests.

## Starter prompt for the next session

> Continue building Lineup from the current repository. Read HANDOFF.md, README.md, DEPLOYMENT.md, and RESEARCH.md first. Preserve the minimal near-black/white/lilac interface and poster-led title popup with independent per-channel notification bells. Review the implemented login and persistence before extending anything. Report the next useful step and then implement it, keeping unfinished live data, external delivery, and deployment limits explicit.
