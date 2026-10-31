import { HttpError, UpstreamError } from "./model.ts";
import type { Store } from "./postgres-store.ts";
// Provider credentials stay server-side. Generic digital dates never become subscription premieres.
// Upstream failures surface as UpstreamError (HTTP 502) with a non-sensitive message.
async function json(url: string, headers: any = {}) {
  let r: Response;
  try {
    r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
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
async function tmdb(path: string) {
  if (!process.env.TMDB_TOKEN)
    throw new HttpError("TMDB_TOKEN is not configured", 503);
  return json("https://api.themoviedb.org/3" + path, {
    Authorization: `Bearer ${process.env.TMDB_TOKEN}`,
  });
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
export async function searchTMDB(q: string) {
  const d: any = await tmdb("/search/multi?query=" + encodeURIComponent(q));
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
      poster: x.poster_path
        ? "https://image.tmdb.org/t/p/w500" + x.poster_path
        : null,
      demo: false,
      genre: x.media_type === "tv" ? "TV series" : "Movie",
      credit: "TMDB catalogue",
    }));
}
export async function importTheatrical(
  store: Pick<Store, "importReleases">,
  market: string,
  from: string,
  to: string,
) {
  const data: any = await tmdb(
    `/discover/movie?region=${market}&with_release_type=2%7C3&release_date.gte=${from}&release_date.lte=${to}`,
  );
  const movies: any[] = data.results || [];
  // Release dates are fetched with limited concurrency; all writes then happen in one
  // locked transaction.
  const dates = await mapLimit(movies, 5, (movie) =>
    tmdb(`/movie/${movie.id}/release_dates`),
  );
  const titles: any[] = [];
  const releases: any[] = [];
  movies.forEach((movie, index) => {
    const id = `tmdb-movie-${movie.id}`;
    titles.push({
      id,
      tmdbId: movie.id,
      name: movie.title,
      mediaType: "movie",
      year: Number(movie.release_date?.slice(0, 4)) || null,
      synopsis: movie.overview,
      poster: movie.poster_path
        ? "https://image.tmdb.org/t/p/w500" + movie.poster_path
        : null,
      demo: false,
      genre: "Movie",
      credit: "TMDB catalogue",
    });
    const regional = (dates[index]?.results || []).find(
      (r: any) => r.iso_3166_1 === market,
    );
    for (const type of [2, 3]) {
      const records = (regional?.release_dates || [])
        .filter((r: any) => r.type === type && typeof r.release_date === "string")
        .sort((a: any, b: any) => a.release_date.localeCompare(b.release_date));
      const r = records[0];
      if (!r) continue;
      releases.push({
        id: `tmdb-${movie.id}-${market}-${type}`,
        titleId: id,
        market,
        medium: "theatrical",
        service: null,
        offer: "ticket",
        date: r.release_date.slice(0, 10),
        precision: "day",
        status: "announced",
        source: `TMDB · ${type === 2 ? "limited theatrical" : "theatrical"}`,
        sourceUrl: `https://www.themoviedb.org/movie/${movie.id}/releases`,
        revision: 1,
      });
    }
  });
  await store.importReleases(titles, releases, {
    id: "tmdb",
    state: "ok",
    updatedAt: new Date().toISOString(),
    note: `Imported ${releases.length} regional events (first discovery page).`,
  });
  return releases.length;
}
export async function hydrateTitle(title: any) {
  if (!title.tmdbId) return title;
  const d: any = await tmdb(`/${title.mediaType}/${title.tmdbId}`);
  return {
    ...title,
    synopsis: d.overview || title.synopsis,
    genre: (d.genres || []).map((g: any) => g.name).join(" · "),
    seasons:
      title.mediaType === "tv"
        ? (d.seasons || [])
            .filter((s: any) => s.season_number > 0)
            .map((s: any) => ({
              number: s.season_number,
              name: s.name,
              episodeCount: s.episode_count,
            }))
        : undefined,
  };
}
export async function hydrateSeason(title: any, number: number) {
  const d: any = await tmdb(`/tv/${title.tmdbId}/season/${number}`);
  // Air dates are metadata only. They do not establish a regional streaming premiere.
  return {
    ...title,
    id: `${title.id}-season-${number}`,
    parentId: title.id,
    season: number,
    name: `${title.name} · Season ${number}`,
    synopsis: d.overview || title.synopsis,
    credit: `Season ${number} · ${(d.episodes || []).length} episodes`,
    seasons: undefined,
    episodes: (d.episodes || []).map((e: any) => ({
      number: e.episode_number,
      name: e.name,
      originalAirDate: e.air_date,
    })),
    poster: d.poster_path
      ? "https://image.tmdb.org/t/p/w500" + d.poster_path
      : title.poster,
  };
}
