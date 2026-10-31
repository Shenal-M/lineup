# Releases.com research and a personal movie and TV release tracker

Research date: 29 October 2026  
Prepared for Shenal Mendis

## Main finding

A clean personal version is feasible. The core requirement is a movie and TV tracker for **theatrical releases and streaming premieres**, with upcoming-month browsing, following and notifications. Digital rental/purchase dates and physical-media dates are optional enhancements. Exact DVD, Blu-ray and 4K dates are not required for the first version.

Releases.com demonstrably uses a first-party catalogue and tracking interface, its own image CDN, YouTube media, and a JustWatch availability widget. Its public pages and scripts do **not** establish who supplies its underlying film metadata or its cinema, VOD, DVD, Blu-ray, and 4K release dates. TMDB is a good source for your implementation, but I cannot identify it as Releases.com's supplier.

The recommended starting point is TMDB for the catalogue, theatrical dates, images and descriptions; TVmaze for TV schedules; and a streaming-announcement adapter for provider premiere dates. No streaming-service links or embedded where-to-watch widget are required. This is a proposed architecture, not a reconstruction of Releases.com's private backend.

## Updated scope

The requirements were clarified on 29 October 2026 after the initial research.

| Priority | Capability | Interpretation |
|---|---|---|
| Required | Theatrical releases | Movie release dates by selected market; venue showtimes are separate |
| Required | VOD and streaming releases | Upcoming movie and TV streaming premieres, including selected-service tracking where dates are available |
| Required | Search and browsing | Search movies and series, inspect seasons, and browse upcoming months |
| Required | Following and reminders | Follow theatrical or streaming releases; notify when dates are announced, changed or due |
| Optional | Digital rental and purchase | Additional rent/buy windows when reliable dates are available |
| Optional | Physical media | Generic physical dates when available; separate disc-format coverage can be deferred |
| Outside requested scope | Streaming-service links | No Watch Now buttons, playback deep links, provider storefront links or embedded offer widgets |

For this report, **streaming** is the main meaning of the user's VOD requirement. The separate **digital** enhancement means transactional rental or purchase. Some upstream datasets use digital more broadly, so adapters must preserve what the source actually establishes.

Provider names, internal provider IDs and markets can still identify release events and filters. A Netflix premiere can be displayed as a date and provider label without linking to Netflix. The missing-link requirement removes integration work, but does not remove the need to source accurate premiere dates.

The first-version acceptance target is theatrical plus streaming tracking and notifications. Disc-data acquisition, edition matching and disc-specific imports are not launch dependencies.

## What was inspected and what remains unknown

The investigation combined direct browser interaction, downloaded public HTML and JavaScript, and official API documentation.

Inspected:

- Home and the movie and TV calendar surfaces.
- Search, using Dune to inspect movie, TV-season and unrelated-category results.
- A movie with several release formats, The Dog Stars.
- A TV season with an estimated year and unknown format dates, Dune Prophecy Season 2.
- A channel-specific tracking action, which opened sign-in.
- The product region selector and its USA and UK options.
- The date-reporting form, which offers missing-data and wrong-data feedback.
- About, Updates, Privacy, and mobile-app information.
- Public base scripts, image paths, widget configuration and request-route names.

Boundaries:

- The local Playwright package was present, but no Chromium binary was installed. The official headless-shell download failed with an invalid/truncated archive. No local headless browser was successfully provisioned. A hosted browser was used for the interactive inspection.
- No Releases.com account was created. Authenticated preferences, actual reminder delivery, and notification timing could not be tested.
- No privileged server access or server-to-server traffic was available. Public frontend code cannot reveal every upstream integration.
- An independent GET to an observed product-partial route returned 403. Route names below are observations from shipped code, not a supported API contract or a successful API integration.
- This covers the relevant public feature families and representative titles, not every title in the site's database.
- Any dates quoted as UI examples describe what Releases.com displayed. They were not independently certified as correct release announcements.

## The capabilities worth reproducing

| Capability | Observed on Releases.com | Treatment for your app |
|---|---|---|
| Search | Mixed-category results show products, channels and date status | Search only movies and series; show seasons inside each series |
| Upcoming browsing | Chronological calendar, channel and tag filters, dedicated date pages | A monthly agenda with previous/next month and quick date ranges |
| Discovery | A separate Hot view and anticipation counts | Optional Popular sort; label whichever metric your source actually supplies |
| Presentation | Cards, items and rows are documented in Updates | One compact row view plus a poster view is enough |
| Product details | Synopsis, media, tags and several release rows | Poster, synopsis, optional trailer, and theatrical/streaming date rows; no streaming-service links |
| Release precision | Exact dates, expected dates, tentative periods and TBA | Preserve these distinctions rather than manufacturing exact dates |
| Tracking | Individual release rows and aggregate tracking controls | Follow theatrical or streaming releases, optionally filtered by service, even before dates are known |
| Region | USA and UK are exposed | Explicit market selection, separate from display timezone |
| Personal list | Tracking-list filtering and display options are documented | A single Following page |
| Corrections | Report date and Submit product | A private Edit date action with a source URL |

Sources: [movie calendar](https://www.releases.com/calendar/movies), [TV calendar](https://www.releases.com/calendar/tv-series), [Updates](https://www.releases.com/site/updates), and the two inspected product pages below.

The smallest useful interface has four destinations: **Upcoming**, **Search**, **Following**, and **Settings**. A title detail drawer can contain the release table and reminder controls. A mobile monthly agenda will generally remain clearer than filling a conventional seven-column calendar with posters.

A reminder example could read: “Follow this movie's US theatrical release and its first streaming premiere; tell me when a date is announced, when it changes, and on release day.” A TV example is “Notify me when the next season premieres on the selected streaming service.” Those reminder rules are recommendations, not verified settings from Releases.com's authenticated interface.

Allow both an **any streaming service** subscription and a **selected service** subscription. Define the first-streaming option by market and qualifying offer type so that an optional rent/buy listing does not accidentally satisfy a subscription-streaming alert.

## What their visible technology actually reveals

| Area | Direct evidence | Conclusion and confidence |
|---|---|---|
| Catalogue | Product IDs, version IDs and region IDs in HTML and handlers | High: their own application models separate release variants |
| Search and calendar | First-party partial routes in public scripts | High: browser interactions go through Releases.com handlers |
| Framework | jQuery 3.7.1 and namespaced routes such as Releases.Core.BL and Releases.Www.PL | High for jQuery; .NET-style application structure is an inference |
| Images | cdn.releases.com/img/image/{UUID}.jpg/{size} | High for serving location; original image supplier unknown |
| Trailers | YouTube links and i.ytimg.com thumbnails | High for the inspected media |
| Streaming availability | JustWatch attribution, data-jw-widget element, and widget loader | High: a JustWatch widget is integrated |
| Analytics | Google tag plus tel.releases.com/pusha in shipped script | High for visible telemetry code; unrelated to movie data |
| Edge | Cloudflare response headers | High for the observed edge; origin host and database unknown |
| Email and push delivery | No provider established through this inspection | Unknown |
| Metadata and release-date acquisition | No conclusive supplier attribution found in sampled assets | Unknown |

Representative observed routes:

~~~text
/partial/Releases.Www.PL.Search.SearchResult
/partial/Releases.Www.PL.Calendar._Actions.LoadMore
/partial/Releases.Www.PL.Product.MainInfo
/partial/Releases.Core.BL.Tracking.ToggleTracking
/partial/Releases.Www.PL.Calendar._Actions.GetNewFilteredUrl
~~~

The tracking handler takes **VersionId** and **RegionId**. That supports a release-specific subscription model rather than a single watchlist flag per movie.

Technical evidence: [public base script](https://www.releases.com/resources/basescripts?hash=1439629027&minify=True), [movie page](https://www.releases.com/p/the-dog-stars), and [public widget loader](https://cdn.releases.com/scripts/justwatch_widget.js). The script hash may change.

### JustWatch has a specific role

The inspected movie HTML configured the widget using a media type, title and year. The loader creates an iframe at widget.justwatch.com/inline_widget. This is a where-to-watch integration.

That does **not** demonstrate that JustWatch supplies the separate release-date rows above it. Nor does hosting a widget imply Releases.com has a JustWatch server API contract.

For your app, the widget is unnecessary because links and offer browsing are outside scope. Retain its integration as evidence about Releases.com, not as a required component of the proposed build.

There is a useful quality lesson: on the inspected second-season page, the widget exposed some links explicitly identifying the first season. Availability for a series must not automatically become availability for an unreleased season.

Sources: [JustWatch widget documentation](https://apis.justwatch.com/docs/widget/) and [Dune Prophecy Season 2 page](https://www.releases.com/p/dune-prophecy-season-2), plus direct browser observations.

### How the date catalogue may be maintained

The About page invites product submissions and date corrections. The visible date-report action opens a feedback form with Missing Data and Wrong Data options. This confirms a human-input path. A mixture of editorial work, community tips and automated imports is plausible, but the proportion and particular suppliers remain unknown.

Source: [About Releases.com](https://www.releases.com/site/about).

## API and source choices

### Recommended source matrix

| Priority | Need | Starting source | Limitation |
|---|---|---|---|
| Core | Titles, synopsis, posters, backdrops, cast and optional trailers | TMDB | Completeness varies |
| Core | Regional theatrical dates | TMDB movie release dates | Validate country-specific entries rather than trusting a fallback display date |
| Core | TV seasons and episode metadata | TMDB | Original air dates are not every country's streaming debut |
| Core | TV network and web episode schedules | TVmaze | Known schedules are incomplete; ordinary country schedule excludes global web channels |
| Core | Near-term streaming premiere announcements | Streaming Availability API by Movie of the Night | Upcoming coverage has service and horizon limits |
| Supporting option | Detect that a title is now streaming | TMDB watch providers | First observed availability does not prove the exact premiere date |
| Alternative | Commercial provider release feed | Watchmode or JustWatch Partner API | Paid access or a partner agreement; verify date coverage before buying |
| Optional | Broad digital rental/purchase windows | TMDB type 4, with source interpretation retained | A generic digital date does not identify a specific service or offer |
| Optional | Broad physical movie date | TMDB type 5 | Does not structurally distinguish disc editions |
| Deferred | Exact DVD, Blu-ray or 4K releases | Additional disc/distributor source | Not required by the clarified scope |

### TMDB as the catalogue foundation

Use movie and TV search, details, images and discovery. TMDB's image configuration supplies the base URL and supported sizes; media records supply image paths. Its developer API is free for noncommercial use with the required attribution.

Useful calls include:

~~~text
GET /3/search/movie?query=...
GET /3/search/tv?query=...
GET /3/movie/{id}
GET /3/tv/{id}
GET /3/configuration
GET /3/movie/{id}/images
GET /3/movie/{id}/videos
GET /3/tv/{id}/season/{number}
~~~

Sources: [Finding Data](https://developer.themoviedb.org/docs/finding-data), [Images](https://developer.themoviedb.org/docs/image-basics), [season details](https://developer.themoviedb.org/reference/tv-season-details), and [API FAQ and attribution](https://developer.themoviedb.org/docs/faq).

Movie release dates are retrieved separately:

~~~text
GET /3/movie/{id}/release_dates
~~~

| TMDB type | Meaning |
|---|---|
| 1 | Premiere |
| 2 | Limited theatrical |
| 3 | Theatrical |
| 4 | Digital |
| 5 | Physical |
| 6 | TV |

Use types 2 and 3 for core theatrical events. Type 4 may supply an optional broad digital event, but must not automatically become a Netflix, Prime Video subscription or other provider premiere. Type 5 is an optional generic physical event; no separate disc-format mapping is needed for the first version.

For discovery, use release-window filters with a region and release type. For example:

~~~text
GET /3/discover/movie
  ?region=US
  &with_release_type=3|2
  &release_date.gte=2026-11-01
  &release_date.lte=2026-11-30
~~~

This finds movies matching the theatrical window. Hydrate each movie's release-date entries before building your own events. An optional type-4 query can collect broad digital dates later; it does not replace the streaming-premiere feed.

Sources: [movie release dates](https://developer.themoviedb.org/reference/movie-release-dates), [movie discovery](https://developer.themoviedb.org/reference/discover-movie), and [region behavior](https://developer.themoviedb.org/docs/region-support).

TMDB's watch-provider endpoint returns country-specific provider availability, grouped by acquisition model. It is powered by JustWatch and requires JustWatch attribution. Checking it can support an “available now, first observed today” notification; that observation must not be described as an independently confirmed launch date. It supplies no forward schedule.

Provider IDs and acquisition models may be used internally without displaying provider playback links. This is a supporting detection adapter, not a required where-to-watch feature.

Sources: [movie watch providers](https://developer.themoviedb.org/reference/movie-watch-providers) and [TV watch providers](https://developer.themoviedb.org/reference/tv-series-watch-providers).

### TVmaze for TV scheduling

Useful endpoints are /lookup/shows?imdb=..., /shows/{id}/episodes, /schedule, /schedule/web, and /schedule/full. The web schedule handles streaming channels; the ordinary country schedule excludes global web channels. The full schedule contains known future episodes.

The public API needs no key. A live lookup by IMDb ID succeeded during this investigation and returned a show ID, external IDs, image URLs and schedule information. Its free data license is CC BY-SA.

Use stable ID matching. Treat a network or global web-channel schedule as that source's schedule, not proof of availability in every country.

Source: [TVmaze API](https://www.tvmaze.com/api).

### Streaming Availability API for near-term provider dates

Movie of the Night documents a free plan with access to all features, subject to plan quotas. Its /v4/changes endpoint supports upcoming show, season and episode changes. Upcoming coverage is limited to Apple TV, Disney+, HBO Max, Netflix, Prime Video and Mubi, within the next 31 days. Unknown timestamps can be included. This is useful for near-term alerts, but cannot supply a complete multi-month streaming calendar.

Source: [API introduction](https://docs.movieofthenight.com/) and [Changes reference](https://docs.movieofthenight.com/resource/changes).

The published supported-country list did not include Sri Lanka. Keep market selection explicit and do not relabel US or Indian availability as Sri Lankan availability.

Source: [Countries and services](https://docs.movieofthenight.com/guide/countries-and-services).

### Watchmode and JustWatch as alternatives

Watchmode documents a title-release-dates endpoint for upcoming/recent streaming premieres. Its current free Developer plan has 2,500 monthly credits but excludes release dates and change tracking. Startup lists those features at USD 349 per month. That makes it difficult to justify for a single-person tracker without a particular coverage need.

Sources: [Watchmode docs](https://api.watchmode.com/docs/), [release-feed distinction](https://api.watchmode.com/use-cases/titles-leaving), and [pricing](https://api.watchmode.com/pricing).

JustWatch's Partner API supports upcoming dates for titles without offers, including imprecise date ranges. Its documentation says a contract precedes issuance of a partner token. Price and the exact coverage for your intended use were not established. Its widget is a separate product and is not needed for the clarified application. Evaluate either commercial feed for release-date coverage rather than its deep-link features.

Source: [JustWatch Partner API](https://apis.justwatch.com/docs/api/).

### Optional physical-media dates

Generic physical dates from TMDB can be displayed when available, with no promise of exact DVD, Blu-ray or 4K granularity. Additional disc sources, edition matching and disc-specific alerts can be deferred entirely.

The original investigation found a country- and date-filtered [Blu-ray.com 4K calendar](https://www.blu-ray.com/movies/releasedates.php?4k=1), but did not verify a suitable official public API. That gap no longer blocks the requested application.

## The data model that makes the app reliable

This is the proposed model, not a claim about Releases.com's database.

A movie, a service, a medium and an offer type are different concepts. A theatrical opening, a streaming premiere and a transactional rental date should remain separate events. A provider's name identifies the streaming event; its playback URL is not required.

| Entity | Suggested fields |
|---|---|
| Title | Internal ID, media type, TMDB ID, IMDb ID, TVmaze ID, name, original name, year, synopsis, image paths |
| Season | Title ID, source season ID, number, name |
| Episode | Season ID, source episode ID, number, title |
| Release event | Title/season/episode target, market, medium, optional service ID, offer type, event kind, date range, precision, status; nullable format/edition reserved for optional physical data |
| Source observation | Event ID, source name, external record ID, URL, raw value, observed time, confidence |
| Subscription | User ID, target, market, selected release categories and providers, reminder rules |
| Notification outbox | Subscription ID, event ID, revision, notification kind, due time, payload, attempts, delivery state |

Give release events independent dimensions:

- Medium: theatrical, digital, subscription streaming, broadcast or physical.
- Service: Netflix, Prime Video, Apple TV, a network, or unknown.
- Offer: subscription, rent, buy, free or ads.
- Physical format and edition: optional nullable fields; exact disc distinctions can be added later.
- Event kind: first release, regional premiere, reissue or catalogue addition.

Maintain date precision separately from confidence. An officially announced year is confirmed at year precision; an exact day can still be only an estimate.

For example, “Q2 2027” can have a display range from 1 April through 30 June, but neither boundary is a release day. A TBA event has no date. Retain a date-only value as a date, and a timed premiere as an instant with source timezone. Do not convert an arbitrary midnight timestamp into a different calendar day.

A subscription should match future events as well as events already present. Following a movie's streaming release today must still work if its first provider premiere is added next month. Store whether the subscription accepts any service or only selected services; no provider URL is needed.

For long-range browsing, retain announced theatrical and TV-season events and provider-specific announcements locally. Refresh them. Polling a 31-day feed over time does not reveal unannounced events six months ahead. If a later-month streaming date has not been sourced, show it as unknown rather than borrowing a theatrical or broad digital date.

## Recommended architecture

Use one TypeScript application and one database. A Next.js interface with server route handlers, PostgreSQL, and a scheduled TypeScript worker is sufficient for this scope. Keep imports and notification jobs in the same repository. A separate search cluster, vector database, agent orchestrator or microservice fleet is unnecessary for the stated workload.

~~~mermaid
flowchart TD
    A["TMDB catalogue and windows"] --> I["Scheduled import and matching"]
    B["TVmaze schedules"] --> I
    C["Streaming announcements"] --> I
    I --> DB["PostgreSQL events and history"]
    U["Minimal web interface"] --> API["Application backend"]
    API <--> DB
    DB --> W["Reminder and outbox worker"]
    W --> E["Email or phone notification"]
~~~

Suggested application endpoints:

~~~text
GET    /api/search?q=...
GET    /api/upcoming?from=...&to=...&market=...&medium=...
GET    /api/titles/{id}
POST   /api/subscriptions
PATCH  /api/subscriptions/{id}
DELETE /api/subscriptions/{id}
PATCH  /api/releases/{id}
GET    /api/notifications
~~~

These are a proposed API, not observed Releases.com routes. The core response exposes titles, date events and provider labels without streaming-service URLs. Optional digital and physical event types can use the same schema later.

For personal use, SQLite is also viable on an always-on host with durable storage and backups. PostgreSQL is the more convenient default if the app and worker use managed or separate runtimes. Protect the application with a single-user login and keep provider credentials on the server.

Source for the application API mechanism: [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers).

### Import and update strategy

Suggested initial cadence, adjustable after observing quotas:

| Work | Initial cadence |
|---|---|
| Upcoming theatrical discovery | Daily, by market and theatrical release type |
| Broad catalogue and season metadata | Daily for followed items; cache other details |
| Near-term streaming feed | Daily, with pagination |
| Followed events due within a week | Every 6 to 12 hours where source quotas allow |
| Optional digital/physical imports | Defer; add only when useful data is available |
| Notification outbox | Every 5 to 15 minutes |
| Source-health check | Daily |

A generic import sequence is: fetch, normalize, match IDs, validate scope, compare with the previous accepted event, record the observation, update the event, and enqueue any applicable notification in the same transaction.

Source-specific failures should preserve the last successful data and mark it stale. An empty response must not silently cancel a release. Keep manual corrections explicit and auditable; a routine import must not overwrite them without applying your resolution policy.

For conflicting reports, prefer a clearly applicable official distributor/provider announcement over a generic or inferred date, while keeping both observations. Distinguish “announced,” “estimated,” “first observed available,” “postponed” and “cancelled.”

### Notification behavior

The reminder system should handle:

1. A date becomes known for a followed category.
2. An announced date changes or a release is postponed.
3. A seven-day or one-day reminder becomes due.
4. The release day arrives.
5. Actual availability is first detected, if enabled.
6. A weekly personal digest is due.

The app should recheck the current event revision before sending. Superseded pending reminders must be cancelled or replaced. A small durable outbox supports retries and recovery after downtime.

Use a uniqueness key such as subscription ID + event ID + event revision + notification kind. Combine persistent database deduplication with the email provider's retry protection. Resend's idempotency window is 24 hours, so provider protection alone is not a permanent notification history.

Advance the event revision only for material schedule or availability changes. A poster or synopsis update must not cause another release alert. A scheduled release-day message should say the release is scheduled for today; only an availability observation supports an available-now message.

Email can use Resend; its documented free tier is 3,000 messages per month and 100 per day, and its setup requires an API key and verified sender domain. Phone alerts can use ntfy, which accepts HTTP publishing requests. An authenticated private topic/server is preferable for personal tracking information.

Sources: [Resend Node guide](https://resend.com/docs/send-with-nodejs), [Resend pricing](https://resend.com/pricing), [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), and [ntfy documentation](https://docs.ntfy.sh/).

## Market and timezone decisions

Start with **US release-market data** unless you specifically want UK or another supported market. Store notification preferences in **Asia/Colombo** independently.

Use ISO country codes in upstream requests: US for the United States and GB for the United Kingdom. Releases.com's internal uk region identifier is not the ISO country code expected by TMDB or TVmaze.

A US theatrical premiere is not a Sri Lankan theatrical premiere. A US Netflix catalogue entry is not confirmation for Netflix Sri Lanka. Likewise, a global TV web-channel schedule does not guarantee a local streaming offer.

If Sri Lankan cinema dates matter, add a local cinema/distributor source later. Precise venue showtimes are a separate feature and dataset.

The interface should show the selected market beside the date and make unknown local coverage visible. Do not silently use a different country's date as a local one.

## A practical delivery sequence

### First build

Implement search, a month-based upcoming agenda, title details, a theatrical/streaming release table, Following and single-user settings. Import the TMDB catalogue and theatrical windows, TVmaze schedules, and the streaming-announcement adapter. Add category/service subscriptions and the durable notification outbox.

A first version is complete when you can follow a movie's theatrical release or a movie/season's streaming premiere and receive the selected notifications. The product does not need streaming-service links, a JustWatch widget, shopping offers, disc scrapers or edition matching.

### Validate streaming dates

Trial the Movie of the Night API against a small benchmark of followed titles and markets. Add availability detection if useful, with first-observed labels. Confirm season matching and subscription-versus-rent/buy semantics.

For browsing beyond the API's near-term window, combine known TV schedules with source-backed provider announcements and a small correction editor. Do not promise several months of exact provider premieres where dates are not yet known. The forward-streaming coverage limitation still matters even after disc requirements are removed.

### Optional release information

Add generic digital rental/purchase and physical dates from TMDB when available. They should enrich title details without delaying the core build. Exact DVD, Blu-ray, 4K, packaging and edition-specific coverage remain deferred.

### Useful additions

Add an iCalendar feed, a weekly digest, watched/dismissed state, reminder snooze and optional phone push once the core dates and reminders are dependable.

## Acceptance checks before relying on reminders

Test behavior, not just whether API calls return JSON.

- A movie releases in cinemas this month and on streaming next month; only the selected category alerts.
- A streaming subscription is created before a provider date exists; it alerts when a matching event is later added.
- A digital rental appears before subscription streaming; it does not trigger a subscription-only reminder.
- An any-service subscription and a selected-service subscription match their intended premiere events.
- Core search, calendar and reminders work when no digital rental/purchase or physical dates exist.
- Title pages and notifications contain no streaming-service playback or storefront links.
- A season page does not show first-season availability as proof that the second season is available.
- An expected year becomes an exact date; the event updates without a false earlier release-day notification.
- A date is postponed after a reminder is queued; the stale reminder is not sent.
- The worker retries or restarts; the same event notification is not delivered repeatedly.
- A source goes offline; the app preserves data and exposes staleness.
- A streaming provider becomes available between checks; the app labels the date as first observed.
- A date-only release remains on the correct market calendar day while notification time follows Colombo preferences.
- Search distinguishes remakes, same-name titles, seasons and reissues using IDs and year.
- The monthly calendar remains useful when some events have only month, quarter or year precision.

Before buying a data service, benchmark its coverage on about 20 titles spanning theatrical releases, streaming-original movies, later streaming windows and returning TV seasons. Measure how many target events it covers, how far ahead dates appear, whether market and season matching are correct, and how quickly changes propagate.

## Recommendation

Build the minimal application around a local release-event database. Prioritize **theatrical and streaming dates, upcoming-month browsing, following and notifications**. Use TMDB for the catalogue and theatrical windows, TVmaze for TV schedules, and a streaming-announcement adapter for provider premieres.

Streaming-service links and the JustWatch widget are unnecessary for this scope. Digital rental/purchase and physical dates are optional enrichment, and exact disc-date coverage is not a launch requirement. The remaining data challenge is accurate provider/season/market matching and streaming announcements beyond the near-term API window; retain unknown dates and source-backed corrections honestly.

