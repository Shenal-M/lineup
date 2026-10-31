"use client";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Card, Empty, Heading, Icon, Modal, channel } from "./ui";
import {
  api,
  countries,
  dateLabel,
  type State,
  type Title,
  type Release,
  type Subscription,
} from "./types";
import { matches } from "../model";

/** Lookups derived once per state (built in LineupApp with useMemo). */
export type Lookup = {
  /** titleId → title */
  titles: Map<string, Title>;
  /** titleId → that title's subscriptions (all markets) */
  subscriptions: Map<string, Subscription[]>;
  /** titleIds followed in the current market */
  followed: Set<string>;
  /** Distinct followed titles across all markets (nav badge). */
  followingCount: number;
  /** titleId → its first release in the current market */
  marketRelease: Map<string, Release>;
  unreadCount: number;
};
export function buildLookup(state: State): Lookup {
  const market = state.settings.market;
  const titles = new Map(state.titles.map((t) => [t.id, t]));
  const subscriptions = new Map<string, Subscription[]>();
  const followed = new Set<string>();
  for (const s of state.subscriptions) {
    const list = subscriptions.get(s.titleId);
    if (list) list.push(s);
    else subscriptions.set(s.titleId, [s]);
    if (s.market === market) followed.add(s.titleId);
  }
  const marketRelease = new Map<string, Release>();
  for (const e of state.releases)
    if (e.market === market && !marketRelease.has(e.titleId))
      marketRelease.set(e.titleId, e);
  return {
    titles,
    subscriptions,
    followed,
    followingCount: subscriptions.size,
    marketRelease,
    unreadCount: state.notifications.filter((n) => !n.read).length,
  };
}
/** True when some subscription of the release's title matches it. */
function followedRelease(lookup: Lookup, e: Release) {
  return !!lookup.subscriptions.get(e.titleId)?.some((s) => matches(s, e));
}

type Shared = {
  state: State;
  lookup: Lookup;
  onSelect: (t: Title) => void;
};
const statusLabel: Record<string, string> = {
  estimated: "Estimated",
  postponed: "Postponed",
  cancelled: "Cancelled",
};
/** Subtle one-line notice shown while the catalogue is sample data. */
function PreviewNotice({ state }: { state: State }) {
  if (!state.titles.some((t) => t.demo)) return null;
  return (
    <p className="notice">
      Preview data. Dates and services are illustrative.{" "}
      <Link href="/settings">Connect sources</Link>
    </p>
  );
}

export type UpcomingFilter = "all" | "theatrical" | "streaming" | "following";
/** Upcoming filter + layout, kept in LineupApp so they survive view switches. */
export type UpcomingView = {
  filter: UpcomingFilter;
  layout: "list" | "grid";
};
const filters: [UpcomingFilter, string][] = [
  ["all", "All"],
  ["theatrical", "In cinemas"],
  ["streaming", "Streaming"],
  ["following", "Following"],
];
export function Upcoming({
  state,
  lookup,
  month,
  setMonth,
  view: { filter, layout },
  setView,
  onSelect,
}: Shared & {
  month: Date;
  setMonth: (d: Date) => void;
  view: UpcomingView;
  setView: (v: UpcomingView) => void;
}) {
  const [horizon, setHorizon] = useState(false);
  const market = state.settings.market,
    prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  // The list is keyed by month + layout. Rows stagger in for the list shown
  // when the view mounts; month/layout changes get a short crossfade instead.
  const listKey = prefix + layout,
    [firstKey] = useState(listKey);
  const { events, groups } = useMemo(() => {
    const events = state.releases
      .filter(
        (e) =>
          e.market === market &&
          e.date?.startsWith(prefix) &&
          (e.precision === "day" || e.precision === "month") &&
          e.status !== "cancelled" &&
          e.status !== "postponed" &&
          lookup.titles.has(e.titleId) &&
          (filter === "all" ||
            filter === e.medium ||
            (filter === "following" && followedRelease(lookup, e))),
      )
      .sort((a, b) => a.date!.localeCompare(b.date!));
    // Day groups in date order; month-precision releases share one group.
    const groups = new Map<string, Release[]>();
    for (const e of events) {
      const key = e.precision === "month" ? "month" : e.date!;
      const list = groups.get(key);
      if (list) list.push(e);
      else groups.set(key, [e]);
    }
    return { events, groups: [...groups] };
  }, [state.releases, market, prefix, filter, lookup]);
  const unknown = useMemo(
    () =>
      state.releases.filter(
        (e) =>
          e.market === market &&
          (e.precision === "unknown" ||
            e.precision === "year" ||
            e.precision === "quarter") &&
          lookup.titles.has(e.titleId),
      ),
    [state.releases, market, lookup],
  );
  const monthName = month.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return (
    <>
      <Heading title="Upcoming">
        <PreviewNotice state={state} />
      </Heading>
      <div className="toolbar">
        <div className="month-nav">
          <button
            aria-label="Previous month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <Icon name="prev" />
          </button>
          <h2>{monthName}</h2>
          <button
            aria-label="Next month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <Icon name="next" />
          </button>
        </div>
        <div className="filters" role="group" aria-label="Filter releases">
          {filters.map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setView({ filter: value, layout })}
              aria-pressed={filter === value}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="view-toggle" role="group" aria-label="Layout">
          <button
            className={layout === "list" ? "active" : ""}
            aria-label="List view"
            aria-pressed={layout === "list"}
            onClick={() => setView({ filter, layout: "list" })}
          >
            <Icon name="list" />
          </button>
          <button
            className={layout === "grid" ? "active" : ""}
            aria-label="Poster view"
            aria-pressed={layout === "grid"}
            onClick={() => setView({ filter, layout: "grid" })}
          >
            <Icon name="grid" />
          </button>
        </div>
      </div>
      <div
        key={listKey}
        className={`releases ${listKey === firstKey ? "stagger" : "swap"}`}
      >
        {!events.length ? (
          <Empty
            title="Nothing scheduled."
            action={
              <Link href="/search" className="primary">
                Find a title
              </Link>
            }
          >
            No releases in {monthName} for {countries[market]}. Try another
            month or follow a title.
          </Empty>
        ) : layout === "list" ? (
          <div className="agenda">
            {groups.map(([date, items]) => {
              const d = new Date(date + "T12:00Z"),
                fmt = (o: Intl.DateTimeFormatOptions) =>
                  d.toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
              return (
                <section key={date}>
                  {date === "month" ? (
                    <h3 className="day month">This month</h3>
                  ) : (
                    <h3 className="day">
                      <span className="dow" aria-hidden="true">
                        {fmt({ weekday: "short" })}
                      </span>
                      <span className="dom" aria-hidden="true">
                        {fmt({ day: "numeric" })}
                      </span>
                      <span className="sr-only">
                        {fmt({ weekday: "long", month: "long", day: "numeric" })}
                      </span>
                    </h3>
                  )}
                  <div className="rows">
                    {items.map((e) => (
                      <Card
                        key={e.id}
                        layout="row"
                        dated={false}
                        title={lookup.titles.get(e.titleId)!}
                        event={e}
                        followed={lookup.followed.has(e.titleId)}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="cards">
            {events.map((e) => (
              <Card
                key={e.id}
                title={lookup.titles.get(e.titleId)!}
                event={e}
                followed={lookup.followed.has(e.titleId)}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
      {unknown.length > 0 && (
        <button className="horizon-link" onClick={() => setHorizon(true)}>
          <span>
            <b>{unknown.length}</b> without a release date yet
          </span>
          <Icon name="next" />
        </button>
      )}
      {horizon && (
        <Modal label="Dates to be announced" onClose={() => setHorizon(false)}>
          <div className="dialog-top">
            <h2>Dates to be announced</h2>
            <button
              className="icon-button"
              aria-label="Close"
              onClick={() => setHorizon(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <p>Follow a title to hear when its date is announced.</p>
          <ul className="sheet-list">
            {unknown.map((e) => {
              const t = lookup.titles.get(e.titleId)!;
              return (
                <li key={e.id}>
                  <button
                    className="sheet-item"
                    onClick={() => {
                      setHorizon(false);
                      onSelect(t);
                    }}
                  >
                    <span className="sheet-title">{t.name}</span>
                    <span className="sheet-meta">
                      <span className={`dot ${e.medium}`} aria-hidden="true" />
                      {[dateLabel(e), channel(e), statusLabel[e.status]]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </>
  );
}

/** Last submitted search, kept in LineupApp so it survives view switches. */
export type SearchMemory = {
  query: string;
  searched: string;
  results: Title[] | null;
};
export function SearchPage({
  state,
  lookup,
  memory,
  onSearched,
  onSelect,
  onError,
}: Shared & {
  memory: SearchMemory;
  onSearched: (m: SearchMemory) => void;
  onError: (e: unknown) => void;
}) {
  const [query, setQuery] = useState(memory.query),
    [busy, setBusy] = useState(false);
  const { results, searched } = memory;
  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // /api/search returns the titles it found; nothing else in the app
      // state changes, so there is no state refetch here.
      const titles = await api<Title[]>(
        "search?q=" + encodeURIComponent(query),
      );
      onSearched({ query, searched: query.trim(), results: titles });
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  const titles = results ?? state.titles;
  return (
    <>
      <Heading title="Search">
        {!state.sources.tmdb && (
          <p className="notice">
            Sample catalogue only. <Link href="/settings">Connect TMDB</Link>{" "}
            for live search.
          </p>
        )}
      </Heading>
      <form className="search-form" role="search" onSubmit={search}>
        <span className="search-field">
          <Icon name="search" />
          <input
            className="search-input"
            type="search"
            aria-label="Search movies and TV"
            placeholder="Movies and TV series"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        <button className="primary" disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {titles.length > 0 ? (
        <>
          <h2 className="list-label">
            {results ? "Results" : "Suggestions"}
            <span>{titles.length}</span>
          </h2>
          <div className="rows stagger">
            {titles.map((t) => (
              <Card
                key={t.id}
                layout="row"
                title={t}
                event={lookup.marketRelease.get(t.id)}
                followed={lookup.followed.has(t.id)}
                onSelect={onSelect}
              />
            ))}
          </div>
        </>
      ) : (
        <Empty title="No matches.">
          {searched
            ? `Nothing found for “${searched}”. Try another spelling.`
            : "Try a different title."}
        </Empty>
      )}
    </>
  );
}

export function Following({ state, lookup, onSelect }: Shared) {
  const items = useMemo(() => {
    // First release per followed title that one of its subscriptions matches.
    const event = new Map<string, Release>();
    for (const e of state.releases)
      if (
        lookup.followed.has(e.titleId) &&
        !event.has(e.titleId) &&
        followedRelease(lookup, e)
      )
        event.set(e.titleId, e);
    return state.titles
      .filter((t) => lookup.followed.has(t.id))
      .map((t) => [t, event.get(t.id)] as const);
  }, [state.titles, state.releases, lookup]);
  return (
    <>
      <Heading title="Following" />
      {items.length ? (
        <div className="rows stagger">
          {items.map(([t, e]) => (
            <Card
              key={t.id}
              layout="row"
              title={t}
              event={e}
              followed
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <Empty
          title="Nothing followed yet."
          action={
            <Link href="/search" className="primary">
              Find a title
            </Link>
          }
        >
          Follow a movie or series to see its dates here, even before
          they’re announced in {countries[state.settings.market]}.
        </Empty>
      )}
    </>
  );
}
