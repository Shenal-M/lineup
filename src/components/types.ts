import type { Release, Subscription } from "../model";
export type { Release, Subscription };
export type Title = {
  id: string;
  name: string;
  mediaType: "movie" | "tv";
  year?: number;
  genre?: string;
  synopsis?: string;
  poster?: string | null;
  /** IMDb id (tt…), when TMDB knows it. */
  imdbId?: string | null;
  /** TMDB popularity score, for sorting upcoming lists. */
  popularity?: number | null;
  /** TV: the show's streaming network (else its first network) and TMDB logo. */
  network?: { name: string; logo: string | null } | null;
  seasons?: { number: number; name: string; episodeCount: number }[];
};
/** A title with its live TMDB dates in every market (null when TMDB is not connected). */
export type Detail = { title: Title; releases: Release[] | null };
export type Season = {
  number: number;
  name: string;
  episodes: { number: number; name: string; originalAirDate?: string }[];
};
export type Settings = {
  id?: string;
  market: string;
  timezone: string;
  hour: number;
};
export type Notice = {
  id: string;
  titleId: string;
  kind: string;
  date: string;
  medium: string;
  service?: string;
  /** Copied on delivery, so the notification survives an unfollow. */
  titleName?: string;
  read: boolean;
};
export type State = {
  titles: Title[];
  releases: Release[];
  subscriptions: Subscription[];
  settings: Settings;
  notifications: Notice[];
  health: { id: string; state: string; note: string; updatedAt: string }[];
  sources: { tmdb: boolean; email?: boolean };
};
export type Page = "movies" | "tv" | "search" | "following" | "settings";
export type User = { email: string };
export const countries: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  LK: "Sri Lanka",
};
export const services = [
  "Netflix",
  "Prime Video",
  "Apple TV",
  "Disney+",
  "HBO Max",
  "Hulu",
  "Peacock",
  "Paramount+",
  "Mubi",
];
// TMDB network logos (transparent PNGs, shown white via CSS). Services without one
// fall back to their initial.
const tmdbLogo = (path: string) => "https://image.tmdb.org/t/p/w300" + path;
export const serviceLogos: Record<string, string> = {
  Netflix: tmdbLogo("/wwemzKWzjKYJFfCeiB57q3r4Bcm.png"),
  "Prime Video": tmdbLogo("/w7HfLNm9CWwRmAMU58udl2L7We7.png"),
  "Apple TV": tmdbLogo("/bngHRFi794mnMq34gfVcm9nDxN1.png"),
  "Disney+": tmdbLogo("/1edZOYAfoyZyZ3rklNSiUpXX30Q.png"),
  "HBO Max": tmdbLogo("/nmU0UMDJB3dRRQSTUqawzF2Od1a.png"),
  Hulu: tmdbLogo("/pqUTCleNUiTLAVlelGxUgWn1ELh.png"),
  Peacock: tmdbLogo("/gIAcGTjKKr0KOHL5s4O36roJ8p7.png"),
  "Paramount+": tmdbLogo("/fi83B1oztoS47xxcemFdPMhIzK.png"),
};
export const rules = [
  ["announced", "Date announced"],
  ["changed", "Date changed"],
  ["week", "7 days before"],
  ["day", "1 day before"],
  ["release", "Release day"],
];
export const defaultRules = ["announced", "changed", "day", "release"];
export function dateLabel(e: Release): string {
  if (!e.date) return "Date TBA";
  if (e.precision === "year") return e.date.slice(0, 4);
  if (e.precision === "quarter")
    return `Q${Math.ceil(Number(e.date.slice(5, 7)) / 3)} ${e.date.slice(0, 4)}`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    ...(e.precision === "day" ? { day: "numeric" } : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(e.date + "T12:00Z"));
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new ApiError(
      `Server returned an invalid response (HTTP ${res.status}). Check deployment configuration.`,
      res.status,
    );
  }
  if (!res.ok) throw new ApiError(result.error || "Request failed", res.status);
  return result;
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
