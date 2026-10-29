import type { Release, Subscription } from "../model";
export type { Release, Subscription };
export type Title = {
  id: string;
  name: string;
  mediaType: "movie" | "tv";
  year?: number;
  genre?: string;
  synopsis?: string;
  credit?: string;
  poster?: string;
  demo?: boolean;
  ink?: string;
  bg?: string;
  art?: string;
  season?: number;
  parentId?: string;
  seasons?: { number: number; name: string; episodeCount: number }[];
  episodes?: { number: number; name: string; originalAirDate?: string }[];
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
  read: boolean;
};
export type State = {
  titles: Title[];
  releases: Release[];
  subscriptions: Subscription[];
  settings: Settings;
  notifications: Notice[];
  health: { id: string; state: string; note: string; updatedAt: string }[];
  sources: { tmdb: boolean; streaming: boolean; email?: boolean };
};
export type Page = "upcoming" | "search" | "following" | "settings";
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
  "Mubi",
];
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
