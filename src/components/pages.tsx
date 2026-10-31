"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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

/** Lookups derived once per state (built in LineupApp with useMemo). */
export type Lookup = {
  /** titleId → stored (followed) title */
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

export type Shared = {
  state: State;
  lookup: Lookup;
  onSelect: (t: Title) => void;
};
const statusLabel: Record<string, string> = {
  estimated: "Estimated",
  postponed: "Postponed",
  cancelled: "Cancelled",
};
export function ConnectNotice({ children }: { children: string }) {
  return (
    <p className="notice">
      <Link href="/settings">Connect TMDB</Link> {children}
    </p>
  );
}

// Live month lists from TMDB, shared across remounts for the session (the server
// caches TMDB too). A failed load is forgotten so the next visit retries.
type Catalog = { titles: Title[]; releases: Release[] };
const CATALOG_MS = 30 * 60 * 1000;
const catalogs = new Map<string, { at: number; data: Promise<Catalog> }>();
function catalog(tab: UpcomingTab, market: string, month: string) {
  const key = `${tab}:${market}:${month}`;
  const hit = catalogs.get(key);
  if (hit && Date.now() - hit.at < CATALOG_MS) return hit.data;
  const data = api<Catalog>(
    `upcoming?type=${tab}&market=${market}&month=${month}`,
  );
  catalogs.set(key, { at: Date.now(), data });
  data.catch(() => catalogs.delete(key));
  return data;
}

export type UpcomingTab = "movie" | "tv";
export type UpcomingFilter = "all" | "theatrical" | "digital";
/** Filter and layout, kept in LineupApp so they survive view switches. */
export type UpcomingView = {
  filter: UpcomingFilter;
  layout: "list" | "grid";
  sort: "date" | "popularity";
};
const filters: [UpcomingFilter, string][] = [
  ["all", "All"],
  ["theatrical", "In cinemas"],
  ["digital", "Digital"],
];
const sorts: [UpcomingView["sort"], string][] = [
  ["date", "By date"],
  ["popularity", "Popular"],
];

const addMonths = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth() + n, 1);
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
/** Local calendar day as YYYY-MM-DD (release dates are plain days). */
function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
const monthLabel = (d: Date, o: Intl.DateTimeFormatOptions) =>
  d.toLocaleDateString("en-US", o);

/**
 * Month pills from last month to five ahead, with arrows to go further. The
 * window only slides when the selected month leaves it, so the current month
 * (marked with a dot) stays put; once it scrolls out of view a "This month"
 * button takes its place as the way back.
 */
function MonthStrip({
  month,
  setMonth,
}: {
  month: Date;
  setMonth: (d: Date) => void;
}) {
  const now = new Date(),
    current = new Date(now.getFullYear(), now.getMonth(), 1),
    offset = monthIndex(month) - monthIndex(current),
    start = offset < -1 ? offset : offset > 5 ? offset - 6 : -1,
    pills = Array.from({ length: 7 }, (_, i) => addMonths(current, start + i)),
    currentShown = start <= 0 && start + 6 >= 0;
  // Keep the selected pill in view when the strip scrolls (mobile).
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current,
      pill = el?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (!el || !pill || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({
      left: pill.offsetLeft - (el.clientWidth - pill.offsetWidth) / 2,
      behavior: scrollBehavior(),
    });
  }, [offset]);
  return (
    <>
      <button
        className="month-arrow"
        aria-label="Previous month"
        onClick={() => setMonth(addMonths(month, -1))}
      >
        <Icon name="prev" />
      </button>
      <div className="month-strip" ref={strip} role="group" aria-label="Month">
        {pills.map((d, i) => {
          const selected = monthIndex(d) === monthIndex(month),
            isCurrent = monthIndex(d) === monthIndex(current),
            // Year on January, or on the first pill when it isn't this year.
            withYear =
              d.getMonth() === 0 ||
              (i === 0 && d.getFullYear() !== current.getFullYear());
          return (
            <button
              key={monthIndex(d)}
              className={`month-pill${selected ? " active" : ""}${isCurrent ? " current" : ""}`}
              aria-pressed={selected}
              aria-current={isCurrent ? "date" : undefined}
              aria-label={
                monthLabel(d, { month: "long", year: "numeric" }) +
                (isCurrent ? " (this month)" : "")
              }
              onClick={() => setMonth(d)}
            >
              {monthLabel(d, { month: "short" })}
              {withYear && (
                <span className="month-year">
                  {monthLabel(d, { year: "numeric" })}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        className="month-arrow"
        aria-label="Next month"
        onClick={() => setMonth(addMonths(month, 1))}
      >
        <Icon name="next" />
      </button>
      {!currentShown && (
        <button className="month-now" onClick={() => setMonth(current)}>
          This month
        </button>
      )}
    </>
  );
}

/** Upcoming movies or TV shows: separate pages, each with its own live month list. */
export function Upcoming({
  kind: tab,
  state,
  lookup,
  month,
  setMonth,
  view,
  setView,
  onSelect,
  onError,
}: Shared & {
  kind: UpcomingTab;
  month: Date;
  setMonth: (d: Date) => void;
  view: UpcomingView;
  setView: (v: UpcomingView) => void;
  onError: (e: unknown) => void;
}) {
  const { layout, sort } = view,
    // Movies only: every TV release is a streaming premiere.
    filter = tab === "movie" ? view.filter : "all";
  const [horizon, setHorizon] = useState(false);
  const market = state.settings.market,
    tmdb = state.sources.tmdb,
    prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const key = `${tab}:${market}:${prefix}`;
  const [loaded, setLoaded] = useState<{ key: string; data: Catalog } | null>(
    null,
  );
  useEffect(() => {
    if (!tmdb) return;
    let live = true;
    catalog(tab, market, prefix).then(
      (data) => {
        if (!live) return;
        setLoaded({ key, data });
        // Warm the other page so switching is instant.
        catalog(tab === "movie" ? "tv" : "movie", market, prefix).catch(() => {});
      },
      (error) => {
        if (!live) return;
        setLoaded({ key, data: { titles: [], releases: [] } });
        onError(error);
      },
    );
    return () => {
      live = false;
    };
  }, [tmdb, tab, market, prefix, key, onError]);
  const live = loaded?.key === key ? loaded.data : null,
    loading = tmdb && !live;
  // The list is keyed by what it shows. Rows stagger in for the first list of a
  // visit; later changes get a short crossfade instead.
  const listKey = `${key}:${layout}:${sort}:${loading ? "loading" : "ready"}`,
    [firstKey] = useState(`${key}:${layout}:${sort}:ready`);
  const { titles, events, groups } = useMemo(() => {
    // Followed titles and their stored dates win over the live list: stored dates
    // carry corrections and are what reminders use.
    const titles = new Map(lookup.titles);
    for (const t of live?.titles || []) if (!titles.has(t.id)) titles.set(t.id, t);
    const byId = new Map<string, Release>();
    for (const e of live?.releases || []) byId.set(e.id, e);
    for (const e of state.releases) byId.set(e.id, e);
    const popularity = (e: Release) => titles.get(e.titleId)?.popularity || 0;
    const events = [...byId.values()]
      .filter(
        (e) =>
          e.market === market &&
          e.date?.startsWith(prefix) &&
          (e.precision === "day" || e.precision === "month") &&
          e.status !== "cancelled" &&
          e.status !== "postponed" &&
          titles.get(e.titleId)?.mediaType === tab &&
          (filter === "all" || filter === e.medium),
      )
      .sort(
        (a, b) =>
          a.date!.localeCompare(b.date!) ||
          Number(lookup.followed.has(b.titleId)) -
            Number(lookup.followed.has(a.titleId)),
      );
    // Popular: one row per release, most popular title first. The sort is
    // stable, so a title's releases stay adjacent and in date order.
    if (sort === "popularity")
      events.sort((a, b) => popularity(b) - popularity(a));
    // Day groups in date order; month-precision releases share one group.
    const groups = new Map<string, Release[]>();
    if (sort === "date")
      for (const e of events) {
        const day = e.precision === "month" ? "month" : e.date!;
        const list = groups.get(day);
        if (list) list.push(e);
        else groups.set(day, [e]);
      }
    return { titles, events, groups: [...groups] };
  }, [live, state.releases, market, prefix, tab, filter, sort, lookup]);
  const unknown = useMemo(
    () =>
      state.releases.filter(
        (e) =>
          e.market === market &&
          (e.precision === "unknown" ||
            e.precision === "year" ||
            e.precision === "quarter") &&
          lookup.titles.get(e.titleId)?.mediaType === tab,
      ),
    [state.releases, market, tab, lookup],
  );
  const monthName = monthLabel(month, { month: "long", year: "numeric" }),
    prev = addMonths(month, -1),
    next = addMonths(month, 1),
    today = isoDay(new Date());
  const noun = tab === "movie" ? "movie" : "TV";
  // Month pager under the list: switch, then bring the top of the list back.
  const top = useRef<HTMLDivElement>(null);
  const turnTo = (d: Date) => {
    setMonth(d);
    top.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  };
  return (
    <>
      <Heading title={tab === "movie" ? "Movies" : "TV shows"}>
        {!tmdb && (
          <ConnectNotice>to see what’s coming out.</ConnectNotice>
        )}
      </Heading>
      <div className="month-bar" ref={top}>
        <h2 className="sr-only">{monthName}</h2>
        <MonthStrip month={month} setMonth={setMonth} />
      </div>
      <div className="toolbar">
        {tab === "movie" && (
          <div className="filters" role="group" aria-label="Filter releases">
            {filters.map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => setView({ ...view, filter: value })}
                aria-pressed={filter === value}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="sort-toggle" role="group" aria-label="Sort releases">
          {sorts.map(([value, label]) => (
            <button
              key={value}
              className={sort === value ? "active" : ""}
              onClick={() => setView({ ...view, sort: value })}
              aria-pressed={sort === value}
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
            onClick={() => setView({ ...view, layout: "list" })}
          >
            <Icon name="list" />
          </button>
          <button
            className={layout === "grid" ? "active" : ""}
            aria-label="Poster view"
            aria-pressed={layout === "grid"}
            onClick={() => setView({ ...view, layout: "grid" })}
          >
            <Icon name="grid" />
          </button>
        </div>
      </div>
      <div
        key={listKey}
        className={`releases ${listKey === firstKey ? "stagger" : "swap"}`}
        aria-busy={loading || undefined}
      >
        {loading && !events.length ? (
          <div className="loading-rows" aria-label="Loading releases">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        ) : !events.length ? (
          <Empty
            title="Nothing scheduled."
            action={
              <Link href="/search" className="primary">
                Find a title
              </Link>
            }
          >
            {tmdb
              ? `No ${noun} releases in ${monthName} for ${countries[market]}. Try another month.`
              : "Followed titles appear here once they have a date."}
          </Empty>
        ) : layout === "grid" ? (
          <div className="cards">
            {events.map((e) => (
              <Card
                key={e.id}
                title={titles.get(e.titleId)!}
                event={e}
                followed={lookup.followed.has(e.titleId)}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : sort === "popularity" ? (
          // No date column here, so each row carries its own date.
          <div className="rows ranked">
            {events.map((e) => (
              <Card
                key={e.id}
                layout="row"
                title={titles.get(e.titleId)!}
                event={e}
                followed={lookup.followed.has(e.titleId)}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : (
          <div className="agenda">
            {groups.map(([date, items]) => {
              const d = new Date(date + "T12:00Z"),
                isToday = date === today,
                fmt = (o: Intl.DateTimeFormatOptions) =>
                  d.toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
              return (
                <section key={date}>
                  {date === "month" ? (
                    <h3 className="day month">This month</h3>
                  ) : (
                    <h3 className={`day${isToday ? " today" : ""}`}>
                      <span className="dow" aria-hidden="true">
                        {isToday ? "Today" : fmt({ weekday: "short" })}
                      </span>
                      <span className="dom" aria-hidden="true">
                        {fmt({ day: "numeric" })}
                      </span>
                      <span className="sr-only">
                        {(isToday ? "Today, " : "") +
                          fmt({ weekday: "long", month: "long", day: "numeric" })}
                      </span>
                    </h3>
                  )}
                  <div className="rows">
                    {items.map((e) => (
                      <Card
                        key={e.id}
                        layout="row"
                        dated={false}
                        title={titles.get(e.titleId)!}
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
        )}
        {/* Followed titles show at once; the rest of the month is still loading. */}
        {loading && events.length > 0 && (
          <div className="loading-rows is-more" aria-label="Loading more releases">
            {Array.from({ length: 3 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        )}
      </div>
      {!loading && (
        <nav className="month-pager" aria-label="More months">
          <button className="pager-prev" onClick={() => turnTo(prev)}>
            <Icon name="prev" />
            {monthLabel(prev, {
              month: "long",
              // Year only when stepping back across a new year.
              ...(prev.getFullYear() !== month.getFullYear() && {
                year: "numeric",
              }),
            })}
          </button>
          <button className="pager-next" onClick={() => turnTo(next)}>
            <span>
              <small>Next month</small>
              {monthLabel(next, { month: "long", year: "numeric" })}
            </span>
            <Icon name="next" />
          </button>
        </nav>
      )}
      {unknown.length > 0 && (
        <button className="horizon-link" onClick={() => setHorizon(true)}>
          <span>
            <b>{unknown.length}</b> followed without a release date yet
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
          <p>You’ll hear when these dates are announced.</p>
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
