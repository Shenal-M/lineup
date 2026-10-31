"use client";
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { BellRing } from "lucide-react";
import { Bell, Empty, Heading, Icon, Poster } from "./ui";
import { api, dateLabel, type Release, type Title } from "./types";
import { ConnectNotice, type Shared } from "./pages";

/** Last submitted search, kept in LineupApp so it survives view switches. */
export type SearchMemory = {
  query: string;
  searched: string;
  results: Title[] | null;
};

// Search responses for this session, keyed by normalised query. Shared by the
// live suggestions and the full search, so submitting a query that was
// already suggested is instant.
const cache = new Map<string, Title[]>();
const cacheKey = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase();
const SUGGEST_MIN = 2;
const SUGGEST_MAX = 7;
const SUGGEST_DELAY = 250;
const suggestible = (q: string) => q.replace(/\s/g, "").length >= SUGGEST_MIN;
const kind = (t: Title) => (t.mediaType === "tv" ? "TV series" : "Movie");

// Suggestions bypass `api()` so they can be aborted; failures stay silent
// (the full search reports errors).
async function fetchSuggestions(q: string, signal: AbortSignal) {
  const res = await fetch("/api/search?q=" + encodeURIComponent(q), {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error("Suggestions failed");
  return (await res.json()) as Title[];
}

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
  const tmdb = state.sources.tmdb;
  const [query, setQuery] = useState(memory.query),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    // Last suggestion list that arrived; shown while the next one loads so
    // the dropdown doesn't flicker or jump between keystrokes.
    [shown, setShown] = useState<Title[] | null>(null);
  const picked = useRef(false);
  const { results, searched } = memory;
  const id = useId(),
    listId = id + "-suggestions",
    optionId = (i: number) => `${id}-option-${i}`;

  const key = cacheKey(query);
  const eligible = tmdb && suggestible(query);
  const cached = eligible ? cache.get(key) : undefined;
  const suggestions = eligible ? (cached ?? shown)?.slice(0, SUGGEST_MAX) : null;
  const loading = eligible && !cached;
  // Suggestions plus the trailing "See all results" option.
  const count = suggestions?.length ? suggestions.length + 1 : 0;
  const expanded = open && count > 0;
  const highlighted = expanded && active < count ? active : -1;

  // Debounced fetch for the current query. Each keystroke aborts the previous
  // request, and a response only renders if its request wasn't aborted, so an
  // older, slower response can never replace a newer one.
  useEffect(() => {
    if (!tmdb || !suggestible(query) || cache.has(cacheKey(query))) return;
    const q = cacheKey(query),
      controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const titles = await fetchSuggestions(q, controller.signal);
        cache.set(q, titles);
        if (!controller.signal.aborted) setShown(titles);
      } catch {
        // Aborted or failed: keep whatever is showing.
      }
    }, SUGGEST_DELAY);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, tmdb]);

  // Keep the keyboard-highlighted option in view when the list scrolls.
  useEffect(() => {
    if (highlighted < 0) return;
    document
      .getElementById(`${id}-option-${highlighted}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [id, highlighted]);

  async function runSearch() {
    const q = query.trim();
    setOpen(false);
    setActive(-1);
    if (!q) return;
    const hit = cache.get(cacheKey(q));
    if (hit) return onSearched({ query, searched: q, results: hit });
    setBusy(true);
    try {
      // Results come live from TMDB; nothing is stored until a title is followed.
      const titles = await api<Title[]>("search?q=" + encodeURIComponent(q));
      cache.set(cacheKey(q), titles);
      onSearched({ query, searched: q, results: titles });
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  function search(e: FormEvent) {
    e.preventDefault();
    void runSearch();
  }
  function choose(i: number) {
    if (!suggestions) return;
    if (i >= suggestions.length) return void runSearch();
    setOpen(false);
    setActive(-1);
    // Focus comes back to the input when the details modal closes; don't
    // reopen the list for that.
    picked.current = true;
    onSelect(suggestions[i]);
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!count) return;
      e.preventDefault();
      const down = e.key === "ArrowDown";
      if (!expanded) {
        setOpen(true);
        setActive(down ? 0 : count - 1);
      } else
        setActive(
          down
            ? (highlighted + 1) % count
            : highlighted <= 0
              ? count - 1
              : highlighted - 1,
        );
    } else if (e.key === "Enter" && highlighted >= 0) {
      // Otherwise Enter falls through to the form's submit.
      e.preventDefault();
      choose(highlighted);
    } else if (e.key === "Escape" && expanded) {
      // Close first; a second Escape clears the field as usual.
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (e.key === "Tab") setOpen(false);
  }

  return (
    <>
      <Heading title="Search">
        {!tmdb && <ConnectNotice>to search.</ConnectNotice>}
      </Heading>
      <form className="search-form" role="search" onSubmit={search}>
        <span className={`search-field${loading ? " loading" : ""}`}>
          <Icon name="search" />
          <input
            className="search-input"
            type="search"
            role="combobox"
            aria-label="Search movies and TV"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={
              highlighted >= 0 ? optionId(highlighted) : undefined
            }
            autoComplete="off"
            spellCheck={false}
            placeholder="Movies and TV series"
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setQuery(value);
              setActive(-1);
              setOpen(true);
              if (!suggestible(value)) setShown(null);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (!picked.current) setOpen(true);
              picked.current = false;
            }}
            onBlur={() => setOpen(false)}
          />
        </span>
        <button className="primary" disabled={busy || !tmdb}>
          {busy ? "Searching…" : "Search"}
        </button>
        {/* Rendered even when closed so aria-controls always resolves.
            mousedown is prevented so a click doesn't blur the input first. */}
        <ul
          id={listId}
          className="suggest"
          role="listbox"
          aria-label="Suggestions"
          hidden={!expanded}
          onMouseDown={(e) => e.preventDefault()}
        >
          {expanded &&
            suggestions!.map((t, i) => (
              <li
                key={t.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === highlighted}
                className="suggest-option"
                onMouseMove={() => i !== highlighted && setActive(i)}
                onClick={() => choose(i)}
              >
                <span className="suggest-thumb" aria-hidden="true">
                  {t.poster && <img src={t.poster} alt="" loading="lazy" />}
                </span>
                <span className="suggest-text">
                  <span className="suggest-name">{t.name}</span>
                  <span className="suggest-meta">
                    {[t.year, kind(t)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {lookup.followed.has(t.id) && (
                  <BellRing
                    className="icon suggest-followed"
                    size={14}
                    strokeWidth={1.75}
                    role="img"
                    aria-label="Following"
                  />
                )}
              </li>
            ))}
          {expanded && (
            <li
              id={optionId(count - 1)}
              role="option"
              aria-selected={highlighted === count - 1}
              className="suggest-option suggest-all"
              onMouseMove={() =>
                highlighted !== count - 1 && setActive(count - 1)
              }
              onClick={() => choose(count - 1)}
            >
              <Icon name="search" size={14} />
              <span className="suggest-name">
                See all results for “{query.trim()}”
              </span>
            </li>
          )}
        </ul>
        <span className="sr-only" aria-live="polite">
          {expanded
            ? `${suggestions!.length} suggestion${suggestions!.length === 1 ? "" : "s"}`
            : ""}
        </span>
      </form>
      {results?.length ? (
        <>
          <h2 className="list-label">
            Results
            <span>{results.length}</span>
          </h2>
          <div className="rows stagger">
            {results.map((t) => (
              <ResultRow
                key={t.id}
                title={t}
                event={lookup.marketRelease.get(t.id)}
                followed={lookup.followed.has(t.id)}
                onSelect={onSelect}
              />
            ))}
          </div>
        </>
      ) : results ? (
        <Empty title="No matches.">
          Nothing found for “{searched}”. Try another spelling.
        </Empty>
      ) : null}
    </>
  );
}

/**
 * A search result: larger poster, year · type, and a short synopsis. Same
 * pattern as Card: the title button stretches over the row (one tab stop) and
 * the bell sits above it. The release date is only shown for followed titles;
 * unfollowed results never have one stored.
 */
const ResultRow = memo(function ResultRow({
  title: t,
  event: e,
  followed,
  onSelect,
}: {
  title: Title;
  event?: Release;
  followed: boolean;
  onSelect: (t: Title) => void;
}) {
  const date = followed && e?.date ? dateLabel(e) : null;
  return (
    <article className="title-row result-row">
      <Poster title={t} />
      <div className="card-text">
        <button className="text-button card-name" onClick={() => onSelect(t)}>
          {t.name}
        </button>
        <div className="card-meta">
          <span>
            {[t.year, kind(t)].filter(Boolean).join(" · ")}
            {date && <span className="result-date"> · {date}</span>}
          </span>
        </div>
        {t.synopsis && <p className="result-synopsis">{t.synopsis}</p>}
      </div>
      <button
        className={`follow-btn ${followed ? "on" : ""}`}
        onClick={() => onSelect(t)}
        aria-label={
          followed
            ? `Following ${t.name} — notification options`
            : `Follow ${t.name}`
        }
      >
        <Bell on={followed} />
      </button>
    </article>
  );
});
