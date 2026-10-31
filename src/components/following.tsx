"use client";
import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { Empty, Heading, Poster, channel } from "./ui";
import { countries, dateLabel, type Release, type Title } from "./types";
import { dayInZone, matches } from "../model";
import type { Lookup, Shared } from "./pages";

type Kind = "all" | "movie" | "tv";
const kinds: [Kind, string][] = [
  ["all", "All"],
  ["movie", "Movies"],
  ["tv", "TV shows"],
];
/** Released entries shown before "Show all". */
const PAST_LIMIT = 10;

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

type Entry = { title: Title; event: Release; days: number };
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
 * A tracked release (or a title with no date yet) as one row. The title
 * button is stretched over the row, so the row is a single tab stop; the
 * right column shows the countdown instead of a bell (everything here is
 * followed).
 */
const Row = memo(function Row({
  title: t,
  event: e,
  days,
  onSelect,
}: {
  title: Title;
  event?: Release;
  days?: number;
  onSelect: (t: Title) => void;
}) {
  const when = days === undefined ? undefined : countdown(days);
  const meta = e
    ? channel(e)
    : [t.year, t.mediaType === "tv" ? "TV series" : "Movie"]
        .filter(Boolean)
        .join(" · ");
  return (
    <article className="title-row follow-row">
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
        {/* Mobile shows the countdown here, under the channel line. */}
        {when && (
          <span
            className={`countdown is-inline${days === 0 ? " today" : ""}`}
            aria-hidden="true"
          >
            {when}
          </span>
        )}
      </div>
      {when ? (
        <span
          className={`countdown${days === 0 ? " today" : ""}`}
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
}: {
  months: Month[];
  today: string;
  onSelect: (t: Title) => void;
}) {
  return months.map((m) => (
    <div key={m.key} className="follow-month">
      <h3 className="follow-month-label">{m.label}</h3>
      <div className="agenda">
        {m.groups.map((g, i) => (
          <section key={g.key + i}>
            <DayLabel group={g} today={today} />
            <div className="rows">
              {g.items.map(({ title, event, days }) => (
                <Row
                  key={event.id}
                  title={title}
                  event={event}
                  days={days}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  ));
}

export function Following({ state, lookup, onSelect }: Shared) {
  const [kind, setKind] = useState<Kind>("all");
  const [showAll, setShowAll] = useState(false);
  const { market, timezone } = state.settings;
  const today = dayInZone(new Date(), timezone);

  // Every live tracked release in the market, split by where it falls.
  const all = useMemo(() => {
    const titles = new Map(
      state.titles
        .filter((t) => lookup.followed.has(t.id))
        .map((t) => [t.id, t]),
    );
    const upcoming: Entry[] = [],
      later: Entry[] = [],
      past: Entry[] = [],
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
      const day = e.precision === "day",
        end = lastDay(e.date, e.precision),
        entry = { title, event: e, days: daysBetween(today, day ? e.date : end) };
      if (end < today) past.push(entry);
      else (day ? upcoming : later).push(entry);
    }
    const byName = (a: Entry, b: Entry) =>
      a.title.name.localeCompare(b.title.name);
    upcoming.sort((a, b) => a.event.date!.localeCompare(b.event.date!) || byName(a, b));
    later.sort(
      (a, b) =>
        lastDay(a.event.date!, a.event.precision).localeCompare(
          lastDay(b.event.date!, b.event.precision),
        ) || byName(a, b),
    );
    past.sort((a, b) => b.event.date!.localeCompare(a.event.date!) || byName(a, b));
    const undated = [...titles.values()]
      .filter((t) => !dated.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { upcoming, later, past, undated, count: titles.size };
  }, [state.titles, state.releases, market, today, lookup]);

  // The same lists for the selected kind, with months grouped for display.
  const view = useMemo(() => {
    const keep = (t: Title) => kind === "all" || t.mediaType === kind;
    const pick = (items: Entry[]) => items.filter((i) => keep(i.title));
    const upcoming = pick(all.upcoming),
      later = pick(all.later),
      past = pick(all.past);
    return {
      upcoming,
      later,
      past,
      undated: all.undated.filter(keep),
      upcomingMonths: byMonth(upcoming),
      laterGroups: byPeriod(later),
    };
  }, [all, kind]);
  const pastMonths = useMemo(
    () => byMonth(showAll ? view.past : view.past.slice(0, PAST_LIMIT)),
    [view.past, showAll],
  );

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
    next = view.upcoming[0];
  const summary = ahead
    ? `${ahead} upcoming` +
      (next ? ` · next: ${next.title.name} ${lower(countdown(next.days))}` : "")
    : view.past.length
      ? "Nothing dated coming up. Released titles are below."
      : "No dates yet. They’ll appear here once announced.";
  const nothing = !ahead && !view.past.length && !view.undated.length;

  return (
    <>
      <Heading title="Following" subtitle={summary} />
      <div className="toolbar">
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

      {nothing && (
        <p className="follow-none">
          No {kind === "movie" ? "movies" : "TV shows"} followed.
        </p>
      )}

      {ahead > 0 && (
        <section className="follow-section" aria-labelledby="follow-upcoming">
          <h2 id="follow-upcoming" className="list-label">
            Upcoming <span>{ahead}</span>
          </h2>
          <Timeline
            months={view.upcomingMonths}
            today={today}
            onSelect={onSelect}
          />
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
              <Row key={t.id} title={t} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}

      {view.past.length > 0 && (
        <section
          className="follow-section follow-past"
          aria-labelledby="follow-released"
        >
          <h2 id="follow-released" className="list-label">
            Released <span>{view.past.length}</span>
          </h2>
          <Timeline months={pastMonths} today={today} onSelect={onSelect} />
          {view.past.length > PAST_LIMIT && (
            <button
              className="text-button follow-more"
              onClick={() => setShowAll(!showAll)}
              aria-expanded={showAll}
            >
              {showAll ? "Show fewer" : `Show all ${view.past.length}`}
            </button>
          )}
        </section>
      )}
    </>
  );
}
