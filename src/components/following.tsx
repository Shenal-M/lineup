"use client";
import Link from "next/link";
import { useMemo } from "react";
import { Card, Empty, Heading } from "./ui";
import { countries, type Release } from "./types";
import { matches } from "../model";
import { trackedTitles } from "./library";
import type { Lookup, Shared } from "./pages";

/** True when some subscription of the release's title matches it. */
function followedRelease(lookup: Lookup, e: Release) {
  return !!lookup.subscriptions.get(e.titleId)?.some((s) => matches(s, e));
}

export function Following({ state, lookup, onSelect }: Shared) {
  const groups = useMemo(() => {
    // First release per followed title that one of its subscriptions matches:
    // the row's fallback when the title has no upcoming dated release.
    const event = new Map<string, Release>();
    for (const e of state.releases)
      if (
        lookup.followed.has(e.titleId) &&
        !event.has(e.titleId) &&
        followedRelease(lookup, e)
      )
        event.set(e.titleId, e);
    // Sorted like the rail's Tracking panel: next date first, undated last.
    const { movies, tv } = trackedTitles(state, lookup);
    const rows = (items: typeof movies) =>
      items.map(
        ({ title: t, next, released }) =>
          [t, next || released || event.get(t.id)] as const,
      );
    return [
      ["Movies", rows(movies)],
      ["TV shows", rows(tv)],
    ] as const;
  }, [state, lookup]);
  const empty = groups.every(([, items]) => !items.length);
  return (
    <>
      <Heading title="Following" />
      {!empty ? (
        groups.map(
          ([label, items]) =>
            items.length > 0 && (
              <section key={label} className="following-group">
                <h2 className="list-label">
                  {label} <span>{items.length}</span>
                </h2>
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
              </section>
            ),
        )
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
