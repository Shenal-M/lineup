"use client";
import { useMemo, useState } from "react";
import { shortDate } from "./ui";
import { dateLabel, type State, type Title, type Release } from "./types";
import { dayInZone } from "../model";
import type { Lookup } from "./pages";

/**
 * A followed title with its soonest upcoming dated release, else its latest
 * past one (already out).
 */
export type Tracked = { title: Title; next?: Release; released?: Release };
export type TrackedGroups = { movies: Tracked[]; tv: Tracked[] };

/** Last day (YYYY-MM-DD) a release's date could fall on, given its precision. */
function lastDay(e: Release & { date: string }) {
  const year = e.date.slice(0, 4);
  if (e.precision === "year") return year + "-12-31";
  if (e.precision === "quarter") {
    const end = Math.ceil(Number(e.date.slice(5, 7)) / 3) * 3;
    return `${year}-${String(end).padStart(2, "0")}-31`;
  }
  if (e.precision === "month") return e.date.slice(0, 7) + "-31";
  return e.date.slice(0, 10);
}

/**
 * Titles followed in the current market, split by kind. Each group is sorted
 * by its next date ascending (undated last), then by name.
 */
export function trackedTitles(state: State, lookup: Lookup): TrackedGroups {
  const market = state.settings.market;
  const today = dayInZone(new Date(), state.settings.timezone);
  // Soonest release per title that is dated, live and not yet past; and the
  // latest one already past, for titles with nothing upcoming.
  const next = new Map<string, Release>(),
    released = new Map<string, Release>();
  for (const e of state.releases) {
    if (
      e.market !== market ||
      !e.date ||
      !lookup.followed.has(e.titleId) ||
      e.status === "cancelled" ||
      e.status === "postponed"
    )
      continue;
    const past = lastDay(e as Release & { date: string }) < today,
      map = past ? released : next,
      prev = map.get(e.titleId);
    if (!prev || (past ? e.date > prev.date! : e.date < prev.date!))
      map.set(e.titleId, e);
  }
  // Upcoming first (soonest first), then already out (latest first), then TBA.
  const rank = (i: Tracked) => (i.next ? 0 : i.released ? 1 : 2);
  const items = state.titles
    .filter((t) => lookup.followed.has(t.id))
    .map(
      (t): Tracked => ({
        title: t,
        next: next.get(t.id),
        released: next.has(t.id) ? undefined : released.get(t.id),
      }),
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.next && b.next ? a.next.date!.localeCompare(b.next.date!) : 0) ||
        (a.released && b.released
          ? b.released.date!.localeCompare(a.released.date!)
          : 0) ||
        a.title.name.localeCompare(b.title.name),
    );
  return {
    movies: items.filter((i) => i.title.mediaType === "movie"),
    tv: items.filter((i) => i.title.mediaType === "tv"),
  };
}

/**
 * Short date line: "Nov 14", "S2 · Dec 3", "Q1 2027", "Out Oct 13" /
 * "S1 out Oct 7" for releases already past, or "Date TBA".
 */
export function nextLabel({ next, released }: Omit<Tracked, "title">) {
  const e = next || released;
  if (!e) return "Date TBA";
  const date = e.precision === "day" ? shortDate(e.date) : dateLabel(e);
  if (released)
    return e.season ? `S${e.season} out ${date}` : `Out ${date}`;
  return e.season ? `S${e.season} · ${date}` : date;
}

/** Tiny poster for the rail; the title's initial when there is no art. */
function Thumb({ title: t }: { title: Title }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="tracking-thumb" aria-hidden="true">
      {t.poster && !failed ? (
        <img src={t.poster} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        t.name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/**
 * Rail panel listing what the user tracks in the current market. Desktop and
 * tablet only: the mobile tab bar hides it (Following covers the same list).
 */
export function Library({
  state,
  lookup,
  activeId,
  onSelect,
}: {
  state: State;
  lookup: Lookup;
  /** Id of the title whose details modal is open. */
  activeId?: string;
  onSelect: (t: Title) => void;
}) {
  const { movies, tv } = useMemo(
    () => trackedTitles(state, lookup),
    [state, lookup],
  );
  const groups = [
    ["Movies", movies],
    ["TV shows", tv],
  ] as const;
  return (
    <section className="tracking" aria-labelledby="tracking-label">
      <h2 id="tracking-label" className="tracking-label">
        Tracking
      </h2>
      {movies.length || tv.length ? (
        <div className="tracking-scroll">
          {groups.map(
            ([label, items]) =>
              items.length > 0 && (
                <div key={label} className="tracking-group">
                  <h3>
                    {label} <span>{items.length}</span>
                  </h3>
                  <ul>
                    {items.map(({ title: t, ...dates }) => (
                      <li key={t.id}>
                        <button
                          className={
                            "tracking-item" + (activeId === t.id ? " active" : "")
                          }
                          aria-current={activeId === t.id ? "true" : undefined}
                          onClick={() => onSelect(t)}
                        >
                          <Thumb title={t} />
                          <span className="tracking-text">
                            <span className="tracking-name">{t.name}</span>
                            <span className="tracking-date">
                              {nextLabel(dates)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
          )}
        </div>
      ) : (
        <p className="tracking-empty">Follow a title to see it here.</p>
      )}
    </section>
  );
}
