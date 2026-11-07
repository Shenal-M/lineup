"use client";
import Link from "next/link";
import { memo, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CircleCheck } from "lucide-react";
import {
  Empty,
  Heading,
  Poster,
  airingEpisode,
  channel,
  shortDate,
} from "./ui";
import {
  api,
  countries,
  dateLabel,
  watchKey,
  type Release,
  type State,
  type Title,
} from "./types";
import { dayInZone, matches } from "../model";
import type { Lookup, Shared } from "./pages";


type Kind = "all" | "movie" | "tv";
const kinds: [Kind, string][] = [
  ["all", "All"],
  ["movie", "Movies"],
  ["tv", "TV shows"],
];
/** Released entries shown before "Show earlier". */
const PAST_LIMIT = 10;

/** Marks (or un-marks) a movie, or one season of a show, as watched. */
export function saveWatched(titleId: string, season: number | undefined, on: boolean) {
  return api("watched", on ? "POST" : "DELETE", { titleId, season });
}

/** True when some subscription of the release's title matches it. */
function followedRelease(lookup: Lookup, e: Release) {
  return !!lookup.subscriptions.get(e.titleId)?.some((s) => matches(s, e));
}

/** Last day (YYYY-MM-DD) a release's date could fall on, given its precision. */
function lastDay(date: string, precision: Release["precision"]) {
  const year = date.slice(0, 4);
  if (precision === "year") return year + "-12-31";
  if (precision === "quarter") {
    const end = Math.ceil(Number(date.slice(5, 7)) / 3) * 3;
    return `${year}-${String(end).padStart(2, "0")}-31`;
  }
  if (precision === "day") return date.slice(0, 10);
  return date.slice(0, 7) + "-31";
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
function daysBetween(from: string, to: string) {
  const t = (d: string) => Date.parse(d.slice(0, 10) + "T00:00Z");
  return Math.round((t(to) - t(from)) / 86_400_000);
}

/**
 * Relative day: "Today", "Tomorrow", "In 5 days", "In 3 weeks", "In 4 months",
 * and the past equivalents ("Yesterday", "12 days ago", "3 months ago").
 */
const SOON_DAYS = 7;
function countdown(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  const n = Math.abs(days),
    [count, unit] =
      n <= 21
        ? [n, "day"]
        : n < 60
          ? [Math.round(n / 7), "week"]
          : n < 548
            ? [Math.round(n / 30.44), "month"]
            : [Math.round(n / 365.25), "year"];
  const span = `${count} ${unit}${count === 1 ? "" : "s"}`;
  return days > 0 ? `In ${span}` : `${span} ago`;
}

const lower = (s: string) => s[0].toLowerCase() + s.slice(1);

/**
 * One row. For a TV season that has premiered and is still airing, `event` is
 * dated at the next episode (so it sorts and counts down to it) and `airing`
 * keeps that episode with the season's premiere date.
 */
type Entry = {
  title: Title;
  event: Release;
  days: number;
  airing?: { episode: number; premiered: string };
};
/** Releases sharing one date-column label (a day, or a period for "Later"). */
type Group = { key: string; date?: string; label?: string; items: Entry[] };
type Month = { key: string; label: string; groups: Group[] };

const monthName = (date: string) =>
  new Date(date.slice(0, 7) + "-15T12:00Z").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Entries (already sorted) grouped by calendar month, then by day; releases
 * without a day precision get their own group labelled with their period.
 */
function byMonth(entries: Entry[]): Month[] {
  const months: Month[] = [];
  for (const entry of entries) {
    const e = entry.event,
      date = e.date!,
      key = date.slice(0, 7),
      day = e.precision === "day" ? date.slice(0, 10) : "~" + dateLabel(e);
    let month = months.at(-1);
    if (month?.key !== key)
      months.push((month = { key, label: monthName(date), groups: [] }));
    let group = month.groups.at(-1);
    if (group?.key !== day)
      month.groups.push(
        (group =
          e.precision === "day"
            ? { key: day, date: day, items: [] }
            : { key: day, label: dateLabel(e), items: [] }),
      );
    group.items.push(entry);
  }
  return months;
}

/** "Later" entries (already sorted) grouped by their period label. */
function byPeriod(entries: Entry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const entry of entries) {
    const label = dateLabel(entry.event);
    let group = groups.get(label);
    if (!group) groups.set(label, (group = { key: label, label, items: [] }));
    group.items.push(entry);
  }
  return [...groups.values()];
}

/** Date column: weekday over day number (like the Upcoming agenda), or a period. */
function DayLabel({ group, today }: { group: Group; today: string }) {
  if (!group.date) return <h4 className="day month">{group.label}</h4>;
  const d = new Date(group.date + "T12:00Z"),
    isToday = group.date === today,
    fmt = (o: Intl.DateTimeFormatOptions) =>
      d.toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  return (
    <h4 className={`day${isToday ? " today" : ""}`}>
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
    </h4>
  );
}

/**
 * Channel line: "Season 4 premieres · Prime Video" for a season still to come,
 * "S4 · Episode 5 · Prime Video" for one airing, else the plain channel.
 */
function rowMeta(e: Release, airing: Entry["airing"], today: string) {
  const where = e.service || "Streaming";
  if (airing) return `S${e.season} · Episode ${airing.episode} · ${where}`;
  if (e.season && e.medium === "streaming" && e.date && lastDay(e.date, e.precision) >= today)
    return `Season ${e.season} premieres · ${where}`;
  return channel(e);
}

/**
 * A tracked release (or a title with no date yet) as one row. The title
 * button is stretched over the row, so the row is a single tab stop; the
 * right column shows the countdown instead of a bell (everything here is
 * followed).
 */
const Row = memo(function Row({
  title: t,
  event: e,
  days,
  airing,
  today,
  onSelect,
  onWatched,
  leaving,
}: {
  title: Title;
  event?: Release;
  days?: number;
  airing?: Entry["airing"];
  today: string;
  onSelect: (t: Title) => void;
  /** Out now rows: marks the row watched (it leaves the list). */
  onWatched?: (t: Title, e: Release) => void;
  /** Just ticked: shows the check on, then the row goes. */
  leaving?: boolean;
}) {
  const when = days === undefined ? undefined : countdown(days),
    // Within a week: the countdown takes the accent, so the nearest stand out.
    soon = days !== undefined && days >= 0 && days <= SOON_DAYS ? " soon" : "";
  const meta = e
    ? rowMeta(e, airing, today)
    : [t.year, t.mediaType === "tv" ? "TV series" : "Movie"]
        .filter(Boolean)
        .join(" · ");
  return (
    <article
      className={`title-row follow-row${onWatched ? " is-past" : ""}${leaving ? " is-leaving" : ""}`}
    >
      <Poster title={t} />
      <div className="card-text">
        <button
          className="text-button card-name"
          onClick={() => onSelect(t)}
          aria-label={when ? `${t.name}, ${when.toLowerCase()}` : undefined}
        >
          {t.name}
        </button>
        <div className="card-meta">
          {e && <span className={`dot ${e.medium}`} aria-hidden="true" />}
          <span>{meta}</span>
        </div>
        {/* Mobile shows the countdown here, under the channel line, beside
            an airing season's premiere date. */}
        {(when || airing) && (
          <div className={`follow-sub${airing ? " has-premiere" : ""}`}>
            {when && (
              <span
                className={`countdown is-inline${soon}`}
                aria-hidden="true"
              >
                {when}
              </span>
            )}
            {airing && (
              <span className="premiered">
                Premiered {shortDate(airing.premiered)}
              </span>
            )}
          </div>
        )}
      </div>
      {onWatched && e ? (
        <button
          className="watch-btn"
          onClick={() => onWatched(t, e)}
          aria-label={`Mark ${t.name}${e.season ? ` season ${e.season}` : ""} watched`}
          aria-pressed={!!leaving}
          title="Mark watched"
        >
          <CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : when ? (
        <span
          className={`countdown${soon}`}
          aria-hidden="true"
        >
          {when}
        </span>
      ) : (
        <span />
      )}
    </article>
  );
});

function Timeline({
  months,
  today,
  onSelect,
  onWatched,
  leaving,
}: {
  months: Month[];
  today: string;
  onSelect: (t: Title) => void;
  onWatched?: (t: Title, e: Release) => void;
  /** Watch keys of rows just ticked. */
  leaving?: Set<string>;
}) {
  return months.map((m) => (
    <div key={m.key} className="follow-month">
      <h3 className="follow-month-label">{m.label}</h3>
      <div className="agenda">
        {m.groups.map((g, i) => (
          <section key={g.key + i}>
            <DayLabel group={g} today={today} />
            <div className="rows">
              {g.items.map(({ title, event, days, airing }) => (
                <Row
                  key={event.id}
                  title={title}
                  event={event}
                  days={days}
                  airing={airing}
                  today={today}
                  onSelect={onSelect}
                  onWatched={onWatched}
                  leaving={leaving?.has(watchKey(title.id, event.season))}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  ));
}


type WatchedItem = { id: string; title: Title; season?: number; watchedAt: string };

/** A watched movie or season; its lime check puts it back in Out now. */
function WatchedRow({
  item,
  leaving,
  onSelect,
  onUnwatch,
}: {
  item: WatchedItem;
  leaving: boolean;
  onSelect: (t: Title) => void;
  onUnwatch: (w: WatchedItem) => void;
}) {
  const t = item.title,
    what = item.season ? `Season ${item.season}` : t.mediaType === "tv" ? "TV series" : "Movie";
  return (
    <article className={`title-row follow-row is-watched${leaving ? " is-leaving" : ""}`}>
      <Poster title={t} />
      <div className="card-text">
        <button className="text-button card-name" onClick={() => onSelect(t)}>
          {t.name}
        </button>
        <div className="card-meta">
          <span>{what}</span>
        </div>
      </div>
      <button
        className="watch-btn is-on"
        onClick={() => onUnwatch(item)}
        aria-label={`Unmark ${t.name}${item.season ? ` season ${item.season}` : ""} watched`}
        aria-pressed="true"
        title="Unmark watched"
      >
        <CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </article>
  );
}

/** Watched titles as a diary: newest first, by the day each was marked. */
function WatchedDiary({
  items,
  leaving,
  today,
  onSelect,
  onUnwatch,
}: {
  items: WatchedItem[];
  leaving: Set<string>;
  today: string;
  onSelect: (t: Title) => void;
  onUnwatch: (w: WatchedItem) => void;
}) {
  const months: { key: string; label: string; days: { date: string; items: WatchedItem[] }[] }[] =
    [];
  for (const w of items) {
    const day = w.watchedAt.slice(0, 10),
      key = day.slice(0, 7);
    let m = months.at(-1);
    if (m?.key !== key) months.push((m = { key, label: monthName(day), days: [] }));
    let d = m.days.at(-1);
    if (d?.date !== day) m.days.push((d = { date: day, items: [] }));
    d.items.push(w);
  }
  return months.map((m) => (
    <div key={m.key} className="follow-month">
      <h3 className="follow-month-label">{m.label}</h3>
      <div className="agenda">
        {m.days.map((d) => (
          <section key={d.date}>
            <DayLabel group={{ key: d.date, date: d.date, items: [] }} today={today} />
            <div className="rows">
              {d.items.map((w) => (
                <WatchedRow
                  key={w.id}
                  item={w}
                  leaving={leaving.has(w.id)}
                  onSelect={onSelect}
                  onUnwatch={onUnwatch}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  ));
}

type Tab = "upcoming" | "out" | "watched";
const tabs: [Tab, string][] = [
  ["upcoming", "Upcoming"],
  ["out", "Out now"],
  ["watched", "Watched"],
];
/** How long a ticked row shows its new state before it leaves the list. */
const LEAVE_MS = 280;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Following: three lists behind a tab bar that stays under the header.
 * Upcoming (dated, later and undated) is always where the page opens; Out now
 * holds released titles until they're ticked watched; Watched is the diary of
 * those, where unticking sends one back. A title's later digital date stays in
 * Upcoming even after its cinema release is watched.
 */
export function Following({
  state,
  lookup,
  onSelect,
  refresh,
  notify,
}: Shared & {
  refresh: () => Promise<State>;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [kind, setKind] = useState<Kind>("all");
  // Rows showing their new state just before they leave, and watched changes
  // saved but not back from the server yet (applied at once).
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Map<string, boolean>>(() => new Map());
  const { market, timezone } = state.settings;
  const today = dayInZone(new Date(), timezone);
  const watchedIds = useMemo(() => {
    const ids = new Set((state.watched || []).map((w) => w.id));
    for (const [id, on] of pending) {
      if (on) ids.add(id);
      else ids.delete(id);
    }
    return ids;
  }, [state.watched, pending]);

  // Every live tracked release in the market, split by where it falls.
  const all = useMemo(() => {
    const titles = new Map(
      state.titles.filter((t) => lookup.followed.has(t.id)).map((t) => [t.id, t]),
    );
    const upcoming: Entry[] = [],
      later: Entry[] = [],
      out: Entry[] = [],
      dated = new Set<string>();
    for (const e of state.releases) {
      const title = titles.get(e.titleId);
      if (
        !title ||
        !e.date ||
        e.market !== market ||
        e.status === "cancelled" ||
        e.status === "postponed" ||
        !followedRelease(lookup, e)
      )
        continue;
      dated.add(title.id);
      // A season already airing waits in Upcoming for its next episode.
      const next = airingEpisode(title, e, today);
      if (next) {
        upcoming.push({
          title,
          event: { ...e, date: next.date },
          days: daysBetween(today, next.date),
          airing: { episode: next.episode, premiered: e.date },
        });
        continue;
      }
      const day = e.precision === "day",
        end = lastDay(e.date, e.precision),
        entry = { title, event: e, days: daysBetween(today, day ? e.date : end) };
      // Watched only hides what's out; a later digital date stays upcoming.
      if (end < today) {
        if (!watchedIds.has(watchKey(title.id, e.season))) out.push(entry);
      } else (day ? upcoming : later).push(entry);
    }
    const byName = (a: Entry, b: Entry) => a.title.name.localeCompare(b.title.name);
    upcoming.sort((a, b) => a.event.date!.localeCompare(b.event.date!) || byName(a, b));
    later.sort(
      (a, b) =>
        lastDay(a.event.date!, a.event.precision).localeCompare(
          lastDay(b.event.date!, b.event.precision),
        ) || byName(a, b),
    );
    // Newest first: what just came out is at the top.
    out.sort((a, b) => b.event.date!.localeCompare(a.event.date!) || byName(a, b));
    const undated = [...titles.values()]
      .filter((t) => !dated.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const watched: WatchedItem[] = (state.watched || [])
      .filter((w) => titles.has(w.titleId) && watchedIds.has(w.id))
      .map((w) => ({ ...w, title: titles.get(w.titleId)! }))
      .sort((a, b) => b.watchedAt.localeCompare(a.watchedAt));
    return { upcoming, later, out, undated, watched, titles, count: titles.size };
  }, [state.titles, state.releases, state.watched, market, today, lookup, watchedIds]);

  // The same lists for the selected kind, with months grouped for display.
  const view = useMemo(() => {
    const keep = (t: Title) => kind === "all" || t.mediaType === kind;
    const pick = (items: Entry[]) => items.filter((i) => keep(i.title));
    const upcoming = pick(all.upcoming),
      later = pick(all.later),
      out = pick(all.out);
    return {
      upcoming,
      later,
      out,
      undated: all.undated.filter(keep),
      watched: all.watched.filter((w) => keep(w.title)),
      upcomingMonths: byMonth(upcoming),
      laterGroups: byPeriod(later),
      outMonths: byMonth(out),
    };
  }, [all, kind]);

  /** Ticks (or unticks) a title: the row shows it, then leaves; saved behind. */
  async function setWatched(t: Title, season: number | undefined, on: boolean) {
    const key = watchKey(t.id, season);
    if (leaving.has(key)) return;
    const mark = (set: boolean) =>
      setLeaving((s) => {
        const n = new Set(s);
        if (set) n.add(key);
        else n.delete(key);
        return n;
      });
    mark(true);
    await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : LEAVE_MS));
    setPending((p) => new Map(p).set(key, on));
    mark(false);
    try {
      await saveWatched(t.id, season, on);
      await refresh();
      notify(`${t.name}${season ? ` · Season ${season}` : ""} ${on ? "moved to Watched" : "back in Out now"}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn’t save that. Try again.");
    } finally {
      setPending((p) => {
        const n = new Map(p);
        n.delete(key);
        return n;
      });
    }
  }

  // Switching tabs while scrolled down starts the new list at its top, with
  // the bar where it sticks.
  const anchor = useRef<HTMLDivElement>(null),
    bar = useRef<HTMLDivElement>(null);
  function pick(next: Tab) {
    if (next === tab) return;
    setTab(next);
    requestAnimationFrame(() => {
      const a = anchor.current,
        b = bar.current;
      if (!a || !b) return;
      const sticky = [b, b.firstElementChild as HTMLElement].find(
        (el) => getComputedStyle(el).position === "sticky",
      );
      const top = window.scrollY + a.getBoundingClientRect().top - parseFloat(sticky ? getComputedStyle(sticky).top : "0");
      if (window.scrollY > top) window.scrollTo(0, top);
    });
  }
  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex(([id]) => id === tab),
      j =
        e.key === "ArrowRight" ? i + 1
        : e.key === "ArrowLeft" ? i - 1
        : e.key === "Home" ? 0
        : e.key === "End" ? tabs.length - 1
        : -2;
    if (j === -2) return;
    e.preventDefault();
    const next = tabs[(j + tabs.length) % tabs.length][0];
    pick(next);
    document.getElementById(`follow-tab-${next}`)?.focus();
  }

  if (!all.count)
    return (
      <>
        <Heading title="Following" />
        <Empty
          title="Nothing followed yet."
          action={
            <Link href="/search" className="primary">
              Find a title
            </Link>
          }
        >
          Follow a movie or series to see its dates here, even before
          they’re announced in {countries[market]}.
        </Empty>
      </>
    );

  const ahead = view.upcoming.length + view.later.length,
    next = view.upcoming[0],
    first = view.later[0];
  const summary = next
    ? `Next: ${next.title.name} ${lower(countdown(next.days))}`
    : first
      ? `Next: ${first.title.name}, ${dateLabel(first.event)}`
      : "Nothing dated coming up.";
  const noun = kind === "movie" ? "movies" : kind === "tv" ? "TV shows" : "titles";
  const counts: Record<Tab, number> = {
    upcoming: ahead + view.undated.length,
    out: view.out.length,
    watched: view.watched.length,
  };

  return (
    <>
      <Heading title="Following" subtitle={summary} />
      <div ref={anchor} />
      <div ref={bar} className="follow-bar">
        <div className="follow-tabs" role="tablist" aria-label="Following" onKeyDown={onTabKey}>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              id={`follow-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls="follow-panel"
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? "active" : ""}
              onClick={() => pick(id)}
            >
              {label}
              {counts[id] > 0 && <span>{counts[id]}</span>}
            </button>
          ))}
        </div>
        <div className="filters" role="group" aria-label="Filter titles">
          {kinds.map(([value, label]) => (
            <button
              key={value}
              className={kind === value ? "active" : ""}
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        id="follow-panel"
        key={tab}
        className="follow-panel"
        role="tabpanel"
        aria-labelledby={`follow-tab-${tab}`}
      >
        {tab === "upcoming" && (
          <>
            {ahead > 0 && (
              <section className="follow-section" aria-label="Dated">
                <Timeline months={view.upcomingMonths} today={today} onSelect={onSelect} />
                {view.laterGroups.length > 0 && (
                  <div className="follow-month">
                    <h3 className="follow-month-label">Later</h3>
                    <div className="agenda">
                      {view.laterGroups.map((g) => (
                        <section key={g.key}>
                          <DayLabel group={g} today={today} />
                          <div className="rows">
                            {g.items.map(({ title, event }) => (
                              <Row
                                key={event.id}
                                title={title}
                                event={event}
                                today={today}
                                onSelect={onSelect}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
            {view.undated.length > 0 && (
              <section className="follow-section" aria-labelledby="follow-undated">
                <h2 id="follow-undated" className="list-label">
                  No date yet <span>{view.undated.length}</span>
                </h2>
                <div className="rows follow-undated">
                  {view.undated.map((t) => (
                    <Row key={t.id} title={t} today={today} onSelect={onSelect} />
                  ))}
                </div>
              </section>
            )}
            {!counts.upcoming && <p className="follow-none">No upcoming {noun}.</p>}
          </>
        )}

        {tab === "out" &&
          (view.out.length ? (
            <section className="follow-section" aria-label="Out now">
              <Timeline
                months={view.outMonths}
                today={today}
                onSelect={onSelect}
                leaving={leaving}
                onWatched={(t, e) => void setWatched(t, e.season, true)}
              />
            </section>
          ) : (
            <p className="follow-none">
              Nothing out right now. Released {noun} wait here until you tick
              them watched.
            </p>
          ))}

        {tab === "watched" &&
          (view.watched.length ? (
            <section className="follow-section" aria-label="Watched">
              <WatchedDiary
                items={view.watched}
                leaving={leaving}
                today={today}
                onSelect={onSelect}
                onUnwatch={(w) => void setWatched(w.title, w.season, false)}
              />
            </section>
          ) : (
            <p className="follow-none">
              Nothing watched yet. Tick a title in Out now and it moves here.
            </p>
          ))}
      </div>
    </>
  );
}
