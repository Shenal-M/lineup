import { test } from "node:test";
import assert from "node:assert/strict";
import {
  movieReleases,
  tvReleases,
  serviceFromNote,
  titleFrom,
  pickTrailer,
} from "../src/providers.ts";

test("digital release notes name a service only for subscription services", () => {
  assert.equal(serviceFromNote("Prime Video"), "Prime Video");
  assert.equal(serviceFromNote("Amazon Prime Video"), "Prime Video");
  assert.equal(serviceFromNote("Apple TV"), "Apple TV");
  assert.equal(serviceFromNote("Max"), "HBO Max");
  for (const note of ["iTunes / Apple TV", "TVOD", "VOD", "", null])
    assert.equal(serviceFromNote(note), null);
});

test("movie dates are regional: earliest wide (else limited) cinema date and earliest digital date", () => {
  const releases = movieReleases({
    id: 7,
    release_dates: {
      results: [
        {
          iso_3166_1: "US",
          release_dates: [
            { type: 1, release_date: "2026-10-04T00:00:00.000Z", note: "Festival" },
            { type: 2, release_date: "2026-10-07T00:00:00.000Z", note: "" },
            { type: 4, release_date: "2026-10-20T00:00:00.000Z", note: "Prime Video" },
            { type: 4, release_date: "2026-10-13T00:00:00.000Z", note: "" },
          ],
        },
        {
          iso_3166_1: "GB",
          release_dates: [
            { type: 2, release_date: "2026-10-01T00:00:00.000Z" },
            { type: 3, release_date: "2026-10-09T00:00:00.000Z" },
            { type: 4, release_date: "2026-11-03T00:00:00.000Z", note: "Netflix" },
          ],
        },
        { iso_3166_1: "FR", release_dates: [{ type: 3, release_date: "2026-09-01T00:00:00.000Z" }] },
      ],
    },
  });
  assert.deepEqual(
    releases.map((e) => [e.id, e.medium, e.service, e.date]),
    [
      ["tmdb-movie-7-US-theatrical", "theatrical", null, "2026-10-07"],
      // The earliest digital date wins even without a service in its note.
      ["tmdb-movie-7-US-digital", "digital", null, "2026-10-13"],
      ["tmdb-movie-7-GB-theatrical", "theatrical", null, "2026-10-09"],
      ["tmdb-movie-7-GB-digital", "digital", "Netflix", "2026-11-03"],
    ],
  );
  assert.equal(releases[0].source, "TMDB · limited theatrical");
});

test("TV dates are season premieres on a streaming network", () => {
  const show = {
    id: 9,
    networks: [{ id: 213, name: "Netflix" }],
    seasons: [
      { season_number: 0, air_date: "2026-12-01" },
      { season_number: 1, air_date: "2024-01-01" },
      { season_number: 2, air_date: "2026-12-01" },
      { season_number: 3, air_date: null },
    ],
  };
  assert.deepEqual(
    tvReleases(show, "2026-11-01").map((e) => [e.id, e.service, e.date, e.season]),
    ["US", "GB", "LK"].map((m) => [`tmdb-tv-9-s2-${m}`, "Netflix", "2026-12-01", 2]),
  );
  // US-only services stay in the US market; broadcast networks give no premieres.
  assert.deepEqual(
    tvReleases({ ...show, networks: [{ id: 453 }] }, "2026-11-01").map((e) => e.market),
    ["US"],
  );
  assert.deepEqual(tvReleases({ ...show, networks: [{ id: 2 }] }, "2026-11-01"), []);
});

test("a season still airing keeps its premiere past the 60-day cutoff", () => {
  const show = {
    id: 9,
    networks: [{ id: 1024 }],
    seasons: [{ season_number: 4, air_date: "2026-08-01" }],
  };
  assert.deepEqual(tvReleases(show, "2026-11-01"), []);
  assert.deepEqual(
    tvReleases({ ...show, next_episode_to_air: { season_number: 4, episode_number: 9 } }, "2026-11-01")
      .map((e) => e.id),
    ["US", "GB", "LK"].map((m) => `tmdb-tv-9-s4-${m}`),
  );
});

test("TV titles carry their next and last episodes (null when TMDB has none)", () => {
  const title: any = titleFrom(
    {
      id: 9,
      name: "Show",
      first_air_date: "2023-10-07",
      seasons: [],
      next_episode_to_air: {
        season_number: 4,
        episode_number: 5,
        air_date: "2026-11-12",
        name: "The Fifth",
      },
      last_episode_to_air: { season_number: 4, episode_number: 4, air_date: "" },
    },
    "tv",
  );
  assert.deepEqual(title.nextEpisode, { season: 4, episode: 5, date: "2026-11-12", name: "The Fifth" });
  assert.deepEqual(title.lastEpisode, { season: 4, episode: 4, date: null });
  const ended: any = titleFrom({ id: 9, name: "Show", next_episode_to_air: null }, "tv");
  assert.equal(ended.nextEpisode, null);
  assert.equal(ended.lastEpisode, null);
  assert.equal("nextEpisode" in titleFrom({ id: 7, title: "Film" }, "movie"), false);
});

test("trailer pick: YouTube trailers, official and English first, then 'Official Trailer', then earliest", () => {
  const v = (key: string, extra: any = {}) => ({
    key,
    name: "Trailer " + key,
    site: "YouTube",
    type: "Trailer",
    official: true,
    iso_639_1: "en",
    published_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  });
  assert.equal(pickTrailer([]), null);
  assert.equal(pickTrailer([v("a", { site: "Vimeo" }), v("b", { type: "Teaser" })]), null);
  // Official beats English beats the name; ties go to the earliest published.
  assert.deepEqual(
    pickTrailer([
      v("unofficial", { official: false, name: "Official Trailer" }),
      v("french", { iso_639_1: "fr", name: "Official Trailer" }),
      v("late", { published_at: "2026-03-01T00:00:00.000Z" }),
      v("early", { published_at: "2025-12-01T00:00:00.000Z" }),
    ]),
    { key: "early", name: "Trailer early" },
  );
  assert.equal(
    pickTrailer([v("plain"), v("named", { name: "Season 1 Official Trailer", published_at: "2026-06-01" })])!
      .key,
    "named",
  );
  assert.equal(pickTrailer([v("x", { official: false })])!.key, "x");
});
