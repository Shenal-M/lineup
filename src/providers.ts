import { HttpError, UpstreamError, type Release } from "./model.ts";
import type { Store } from "./postgres-store.ts";
// Provider credentials stay server-side. Upstream failures surface as UpstreamError
// (HTTP 502) with a non-sensitive message.
async function json(url: string, headers: any = {}, revalidate = 0) {
  let r: Response;
  try {
    r = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
      // Next.js data cache (ignored outside Next): TMDB responses are shared across
      // requests and instances for `revalidate` seconds.
      ...(revalidate ? { cache: "force-cache", next: { revalidate } } : {}),
    } as RequestInit);
  } catch (e) {
    throw new UpstreamError(
      e instanceof Error && e.name === "TimeoutError"
        ? "TMDB did not respond in time"
        : "Could not reach TMDB",
    );
  }
  if (!r.ok) throw new UpstreamError(`TMDB returned HTTP ${r.status}`);
  try {
    return await r.json();
  } catch {
    throw new UpstreamError("TMDB returned an invalid response");
  }
}
const HOUR = 3600;
async function tmdb(path: string, revalidate = 6 * HOUR) {
  if (!process.env.TMDB_TOKEN)
    throw new HttpError("TMDB_TOKEN is not configured", 503);
  return json(
    "https://api.themoviedb.org/3" + path,
    { Authorization: `Bearer ${process.env.TMDB_TOKEN}` },
    revalidate,
  );
}
// Runs fn over items with at most `limit` in flight; rejects on the first failure.
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const MARKETS = ["US", "GB", "LK"];
const poster = (path?: string | null) =>
  path ? "https://image.tmdb.org/t/p/w500" + path : null;
const day = (d: string) => d.slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(date + "T12:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthEnd = (month: string) => {
  const d = new Date(month + "-01T12:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

// Subscription services named in TMDB digital-release notes, shown as a hint next to
// the digital date. Store notes such as "iTunes / Apple TV" or "TVOD" name no service.
const SERVICE_NOTES: [RegExp, string][] = [
  [/^netflix$/i, "Netflix"],
  [/^(amazon )?prime video$/i, "Prime Video"],
  [/^apple tv\+?$/i, "Apple TV"],
  [/^disney\+$/i, "Disney+"],
  [/^(hbo )?max$/i, "HBO Max"],
  [/^hulu$/i, "Hulu"],
  [/^peacock$/i, "Peacock"],
  [/^paramount\+$/i, "Paramount+"],
  [/^mubi$/i, "Mubi"],
];
export function serviceFromNote(note: unknown) {
  const text = typeof note === "string" ? note.trim() : "";
  return SERVICE_NOTES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
// TV networks that are streaming services. A season's air date on one of these is its
// premiere on that service; services that are not global are limited to the US market.
const NETWORKS: Record<number, string> = {
  213: "Netflix",
  1024: "Prime Video",
  2552: "Apple TV",
  2739: "Disney+",
  49: "HBO Max",
  3186: "HBO Max",
  6783: "HBO Max",
  453: "Hulu",
  3353: "Peacock",
  4330: "Paramount+",
};
const US_ONLY = new Set(["HBO Max", "Hulu", "Peacock", "Paramount+"]);
const NETWORK_IDS = Object.keys(NETWORKS).join("%7C");

export type Entry = { title: any; releases: Release[] };
const TITLE_ID = /^tmdb-(movie|tv)-(\d+)$/;
export const isTmdbTitle = (id: string) => TITLE_ID.test(id);

// A show's streaming network (else its first network), with TMDB's logo.
function network(d: any) {
  const n =
    (d.networks || []).find((x: any) => NETWORKS[x.id]) || (d.networks || [])[0];
  return n
    ? {
        name: NETWORKS[n.id] || n.name,
        logo: n.logo_path ? "https://image.tmdb.org/t/p/w300" + n.logo_path : null,
      }
    : null;
}
function titleFrom(d: any, mediaType: "movie" | "tv") {
  const date = mediaType === "movie" ? d.release_date : d.first_air_date;
  const imdbId = d.imdb_id || d.external_ids?.imdb_id || null;
  return {
    id: `tmdb-${mediaType}-${d.id}`,
    tmdbId: d.id,
    name: d.title || d.name,
    mediaType,
    year: Number((date || "").slice(0, 4)) || null,
    synopsis: d.overview || "",
    poster: poster(d.poster_path),
    genre: (d.genres || []).map((g: any) => g.name).join(" · "),
    imdbId,
    popularity: typeof d.popularity === "number" ? d.popularity : null,
    ...(mediaType === "tv"
      ? {
          network: network(d),
          seasons: (d.seasons || [])
            .filter((s: any) => s.season_number > 0)
            .map((s: any) => ({
              number: s.season_number,
              name: s.name,
              episodeCount: s.episode_count,
            })),
        }
      : {}),
  };
}
// Regional dates for a movie: the earliest wide (or else limited) cinema date and the
// earliest digital (VOD) date.
export function movieReleases(d: any): Release[] {
  const titleId = `tmdb-movie-${d.id}`;
  const sourceUrl = `https://www.themoviedb.org/movie/${d.id}/releases`;
  const out: Release[] = [];
  for (const market of MARKETS) {
    const dates: any[] = (d.release_dates?.results || []).find(
      (r: any) => r.iso_3166_1 === market,
    )?.release_dates || [];
    const earliest = (type: number) =>
      dates
        .filter((x) => x.type === type && typeof x.release_date === "string")
        .map((x) => day(x.release_date))
        .sort()[0];
    const wide = earliest(3),
      cinema = wide || earliest(2);
    if (cinema)
      out.push({
        id: `${titleId}-${market}-theatrical`,
        titleId,
        market,
        medium: "theatrical",
        service: null,
        offer: "ticket",
        date: cinema,
        precision: "day",
        status: "announced",
        source: wide ? "TMDB · theatrical" : "TMDB · limited theatrical",
        sourceUrl,
        revision: 1,
      });
    // The earliest digital release, whatever it is (rent/buy, VOD or a streaming
    // premiere). A subscription service named in its note is kept as a hint.
    const first = dates
      .filter((x) => x.type === 4 && typeof x.release_date === "string")
      .sort((a, b) => a.release_date.localeCompare(b.release_date))[0];
    if (first) {
      const service = serviceFromNote(first.note);
      out.push({
        id: `${titleId}-${market}-digital`,
        titleId,
        market,
        medium: "digital",
        service,
        offer: "digital",
        date: day(first.release_date),
        precision: "day",
        status: "announced",
        source: service ? `TMDB · digital (${service})` : "TMDB · digital",
        sourceUrl,
        revision: 1,
      });
    }
  }
  return out;
}
// Season premieres of a show on its streaming network. Seasons that aired more than
// 60 days ago are history, not upcoming releases.
export function tvReleases(d: any, today = new Date().toISOString().slice(0, 10)): Release[] {
  const service = (d.networks || []).map((n: any) => NETWORKS[n.id]).find(Boolean);
  if (!service) return [];
  const titleId = `tmdb-tv-${d.id}`;
  const cutoff = addDays(today, -60);
  const out: Release[] = [];
  for (const s of d.seasons || []) {
    if (!(s.season_number > 0) || typeof s.air_date !== "string" || day(s.air_date) < cutoff)
      continue;
    for (const market of US_ONLY.has(service) ? ["US"] : MARKETS)
      out.push({
        id: `${titleId}-s${s.season_number}-${market}`,
        titleId,
        market,
        medium: "streaming",
        service,
        offer: "subscription",
        date: day(s.air_date),
        precision: "day",
        status: "announced",
        season: s.season_number,
        source: `TMDB · ${service} air date`,
        sourceUrl: `https://www.themoviedb.org/tv/${d.id}/season/${s.season_number}`,
        revision: 1,
      });
  }
  return out;
}

// One title with its dates in every supported market.
export async function titleDetails(id: string): Promise<Entry> {
  const m = id.match(TITLE_ID);
  if (!m) throw new HttpError("Title not found", 404);
  if (m[1] === "movie") {
    const d = await tmdb(`/movie/${m[2]}?append_to_response=release_dates`);
    return { title: titleFrom(d, "movie"), releases: movieReleases(d) };
  }
  const d = await tmdb(`/tv/${m[2]}?append_to_response=external_ids`);
  return { title: titleFrom(d, "tv"), releases: tvReleases(d) };
}
export async function seasonEpisodes(id: string, number: number) {
  const m = id.match(TITLE_ID);
  if (!m || m[1] !== "tv") throw new HttpError("Title not found", 404);
  const d: any = await tmdb(`/tv/${m[2]}/season/${number}`);
  return {
    number,
    name: d.name || `Season ${number}`,
    episodes: (d.episodes || []).map((e: any) => ({
      number: e.episode_number,
      name: e.name,
      originalAirDate: e.air_date,
    })),
  };
}
export async function searchTMDB(q: string) {
  const d: any = await tmdb("/search/multi?query=" + encodeURIComponent(q), HOUR);
  return (d.results || [])
    .filter((x: any) => ["movie", "tv"].includes(x.media_type))
    .map((x: any) => ({
      id: `tmdb-${x.media_type}-${x.id}`,
      tmdbId: x.id,
      name: x.title || x.name,
      mediaType: x.media_type,
      year:
        Number((x.release_date || x.first_air_date || "").slice(0, 4)) || null,
      synopsis: x.overview,
      poster: poster(x.poster_path),
      genre: x.media_type === "tv" ? "TV series" : "Movie",
      popularity: typeof x.popularity === "number" ? x.popularity : null,
    }));
}
// Upcoming titles of one kind with a release in `market` during `month` (YYYY-MM).
// Discovery finds candidates; each candidate's details (cached) give the regional dates.
export async function upcoming(kind: "movie" | "tv", market: string, month: string) {
  const from = month + "-01",
    to = monthEnd(month);
  const candidates =
    kind === "movie"
      ? (
          await Promise.all(
            // Two pages of cinema releases and one of digital releases.
            ["2%7C3&page=1", "2%7C3&page=2", "4&page=1"].map((query) =>
              tmdb(
                `/discover/movie?region=${market}&release_date.gte=${from}&release_date.lte=${to}&sort_by=popularity.desc&with_release_type=${query}`,
              ),
            ),
          )
        )
          .flatMap((d: any) => d.results || [])
          // Re-releases of older films match the regional date filter too.
          .filter((x: any) => !x.release_date || x.release_date >= addDays(from, -365))
      : (
          await Promise.all(
            [1, 2].map((page) =>
              tmdb(
                `/discover/tv?air_date.gte=${from}&air_date.lte=${to}&with_networks=${NETWORK_IDS}&sort_by=popularity.desc&page=${page}`,
              ),
            ),
          )
        ).flatMap((d: any) => d.results || []);
  const ids = [...new Set<number>(candidates.map((x: any) => x.id))];
  const entries = await mapLimit(ids, 8, (n) => titleDetails(`tmdb-${kind}-${n}`));
  const titles: any[] = [],
    releases: Release[] = [];
  for (const { title, releases: all } of entries) {
    const due = all.filter(
      (e) => e.market === market && !!e.date && e.date >= from && e.date <= to,
    );
    if (!due.length) continue;
    titles.push(title);
    releases.push(...due);
  }
  return { titles, releases };
}

// Kept for bulk loading a month of theatrical releases from the command line
// (`npm run import`); the app itself stores only followed titles.
export async function importTheatrical(
  store: Pick<Store, "importReleases">,
  market: string,
  from: string,
  to: string,
) {
  const data: any = await tmdb(
    `/discover/movie?region=${market}&with_release_type=2%7C3&release_date.gte=${from}&release_date.lte=${to}`,
    0,
  );
  const movies: any[] = data.results || [];
  // Release dates are fetched with limited concurrency; all writes then happen in one
  // locked transaction.
  const details = await mapLimit(movies, 5, (movie) =>
    tmdb(`/movie/${movie.id}?append_to_response=release_dates`, 0),
  );
  const releases = details
    .flatMap(movieReleases)
    .filter((e) => e.market === market && e.medium === "theatrical");
  await store.importReleases(
    details.map((d) => titleFrom(d, "movie")),
    releases,
    {
      id: "tmdb",
      state: "ok",
      updatedAt: new Date().toISOString(),
      note: `Imported ${releases.length} regional events (first discovery page).`,
    },
  );
  return releases.length;
}
