"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Card, Empty, Heading, Modal } from "./ui";
import {
  api,
  countries,
  dateLabel,
  type State,
  type Title,
  type Release,
} from "./types";
import { matches } from "../model";
type Shared = { state: State; onSelect: (t: Title) => void };
export function Upcoming({
  state,
  month,
  setMonth,
  onSelect,
}: Shared & { month: Date; setMonth: (d: Date) => void }) {
  const [filter, setFilter] = useState("all"),
    [view, setView] = useState("list"),
    [horizon, setHorizon] = useState(false);
  const market = state.settings.market,
    prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const events = state.releases
    .filter(
      (e) =>
        e.market === market &&
        e.date?.startsWith(prefix) &&
        ["day", "month"].includes(e.precision) &&
        !["cancelled", "postponed"].includes(e.status) &&
        (filter === "all" ||
          filter === e.medium ||
          (filter === "following" &&
            state.subscriptions.some((s) => matches(s, e)))),
    )
    .sort((a, b) => a.date!.localeCompare(b.date!));
  const groups: Record<string, Release[]> = {};
  for (const e of events) {
    const key = e.precision === "month" ? "month" : e.date!;
    (groups[key] ??= []).push(e);
  }
  const unknown = state.releases.filter(
    (e) =>
      e.market === market &&
      ["unknown", "year", "quarter"].includes(e.precision),
  );
  return (
    <>
      <Heading
        title="Upcoming releases."
        subtitle="Theatrical and streaming premieres, in one place."
      />
      <div className="sample">
        <div>
          <b>Preview data</b> · Dates and services are illustrative.
        </div>
        <Link href="/settings">Connect sources ↗</Link>
      </div>
      <div className="toolbar">
        <div className="month-nav">
          <button
            aria-label="Previous month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            ‹
          </button>
          <h2>
            {month.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <button
            aria-label="Next month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            ›
          </button>
        </div>
        <div className="filters">
          {[
            ["all", "All releases"],
            ["theatrical", "In cinemas"],
            ["streaming", "Streaming"],
            ["following", "Following"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="view-toggle">
          <button
            className={view === "grid" ? "active" : ""}
            aria-label="Poster view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            ▦
          </button>
          <button
            className={view === "list" ? "active" : ""}
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            ☷
          </button>
        </div>
      </div>
      {!events.length && (
        <Empty
          title="No releases yet."
          action={
            <Link href="/search" className="primary">
              Find a title ↗
            </Link>
          }
        >
          No sourced releases for this month in {countries[market]}. Try another
          month or add a verified date.
        </Empty>
      )}
      <div className={view === "list" ? "list" : ""}>
        {Object.entries(groups).map(([date, items]) => (
          <section key={date}>
            <div className="section-line">
              <h3>
                {date === "month"
                  ? "Sometime this month"
                  : new Date(date + "T12:00Z").toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
              </h3>
              <span>
                {items.length} {items.length === 1 ? "release" : "releases"}
              </span>
            </div>
            <div className="cards">
              {items.map((e) => {
                const t = state.titles.find((t) => t.id === e.titleId);
                return t ? (
                  <Card
                    key={e.id}
                    title={t}
                    event={e}
                    state={state}
                    onSelect={onSelect}
                  />
                ) : null;
              })}
            </div>
          </section>
        ))}
      </div>
      {unknown.length > 0 && (
        <div className="uncertain">
          <div>
            <h3>Dates to be announced</h3>
            <p>
              {unknown.length} releases have a broader window or no date. Follow
              them to hear when a date is added.
            </p>
          </div>
          <button onClick={() => setHorizon(true)}>
            Explore the horizon →
          </button>
        </div>
      )}
      {horizon && (
        <Modal label="On the horizon" onClose={() => setHorizon(false)}>
          <div className="dialog-top">
            <h2>On the horizon</h2>
            <button aria-label="Close" onClick={() => setHorizon(false)}>
              ×
            </button>
          </div>
          {unknown.map((e) => (
            <div className="release-row" key={e.id}>
              <button
                className="text-button"
                onClick={() => {
                  setHorizon(false);
                  const t = state.titles.find((t) => t.id === e.titleId);
                  if (t) onSelect(t);
                }}
              >
                {state.titles.find((t) => t.id === e.titleId)?.name} ↗
              </button>
              <small>
                {dateLabel(e)} · {e.service || e.medium} · {e.status}
              </small>
            </div>
          ))}
        </Modal>
      )}
    </>
  );
}
export function SearchPage({
  state,
  refresh,
  onSelect,
  onError,
}: Shared & { refresh: () => Promise<State>; onError: (e: unknown) => void }) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Title[] | null>(null),
    [busy, setBusy] = useState(false);
  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const titles = await api<Title[]>(
        "search?q=" + encodeURIComponent(query),
      );
      await refresh();
      setResults(titles);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  const titles = results ?? state.titles;
  return (
    <>
      <Heading
        title="Find a title."
        subtitle="Search movies and series, then choose which releases to follow."
      />
      <form onSubmit={search}>
        <input
          className="search-input"
          type="search"
          aria-label="Search movies and TV"
          placeholder="Search movies & TV series…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary" disabled={busy}>
          {busy ? "Searching…" : "Search titles ↗"}
        </button>
      </form>
      <p className="fineprint">
        {state.sources.tmdb
          ? "Searching the TMDB catalogue."
          : "Sample catalogue only. Connect TMDB for live search."}
      </p>
      <div className="section-line">
        <h3>{results ? "SEARCH RESULTS" : "A LITTLE INSPIRATION"}</h3>
        <span>{titles.length} titles</span>
      </div>
      <div className="cards">
        {titles.map((t) => (
          <Card
            key={t.id}
            title={t}
            event={state.releases.find(
              (e) => e.titleId === t.id && e.market === state.settings.market,
            )}
            state={state}
            onSelect={onSelect}
          />
        ))}
      </div>
      {!titles.length && (
        <Empty title="No titles found.">
          Try a different title or connect TMDB for the full catalogue.
        </Empty>
      )}
    </>
  );
}
export function Following({ state, onSelect }: Shared) {
  const ids = new Set(
    state.subscriptions
      .filter((s) => s.market === state.settings.market)
      .map((s) => s.titleId),
  );
  return (
    <>
      <Heading
        title="Following."
        subtitle={`Your followed releases in ${countries[state.settings.market]}. Dates may be unknown; you can follow anyway.`}
      />
      <div className="cards">
        {state.titles
          .filter((t) => ids.has(t.id))
          .map((t) => (
            <Card
              key={t.id}
              title={t}
              event={state.releases.find(
                (e) =>
                  e.titleId === t.id &&
                  state.subscriptions.some((s) => matches(s, e)),
              )}
              state={state}
              onSelect={onSelect}
            />
          ))}
      </div>
      {!ids.size && (
        <Empty
          title="Nothing followed yet."
          action={
            <Link href="/search" className="primary">
              Discover something great ↗
            </Link>
          }
        >
          Follow a theatrical release or a streaming premiere. We’ll keep your
          preferences even before a date is announced.
        </Empty>
      )}
    </>
  );
}
