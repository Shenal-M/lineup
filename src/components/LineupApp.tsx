"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { AuthPanel } from "./AuthPanel";
import { Brand, Bell, Modal, Empty, Icon, shortDate } from "./ui";
import { Upcoming, buildLookup, type UpcomingView } from "./pages";
import { SearchPage, type SearchMemory } from "./search";
import { Following } from "./following";
import { Library } from "./library";
import { SettingsPage } from "./SettingsPage";
import { TitleDetails } from "./TitleDetails";
import {
  api,
  ApiError,
  message,
  countries,
  type State,
  type Title,
  type Release,
  type Detail,
  type User,
  type Page,
} from "./types";

type AuthStatus = {
  setupRequired: boolean;
  setupKeyRequired: boolean;
  authenticated: boolean;
  user: User | null;
};
const signedOut: AuthStatus = {
  setupRequired: false,
  setupKeyRequired: false,
  authenticated: false,
  user: null,
};
const pages: Record<string, Page> = {
  "/tv": "tv",
  "/search": "search",
  "/following": "following",
  "/settings": "settings",
};
const nav = [
  ["movies", "/", "film", "Movies"],
  ["tv", "/tv", "tv", "TV shows"],
  ["search", "/search", "search", "Search"],
  ["following", "/following", "heart", "Following"],
  ["settings", "/settings", "settings", "Settings"],
] as const;
const kinds: Record<string, string> = {
  announced: "Date announced",
  changed: "Details changed",
  week: "In 7 days",
  day: "Tomorrow",
  release: "Today",
};
const emptySearch: SearchMemory = { query: "", searched: "", results: null };

// /api/state also names the signed-in owner, so opening the app is one request.
type Loaded = State & { user?: User | null };
// The last loaded state, kept in this browser so a returning visit renders at
// once and refreshes behind it. Cleared on sign-out and whenever the session
// turns out to be gone. Storage can be unavailable (private mode): best effort.
const CACHE_KEY = "lineup:last-state";
function readCache(): { user: User; state: State } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return saved?.user?.email && saved.state?.settings ? saved : null;
  } catch {
    return null;
  }
}
function writeCache(user: User, state: State) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user, state }));
  } catch {}
}
function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}
function split({ user, ...state }: Loaded) {
  return { user: user || null, state: state as State };
}
// Started as soon as this module runs in the browser, before React hydrates;
// the first boot picks it up. A signed-out visitor's 401 is handled there.
let firstLoad: Promise<Loaded> | null =
  typeof window === "undefined" ? null : api<Loaded>("state");
firstLoad?.catch(() => {});
const defaultView: UpcomingView = { filter: "all", layout: "list", sort: "date" };
/** The open title; `releases` is undefined while its TMDB dates load. */
type Active = { title: Title; releases?: Release[] | null };

// Toast: a tiny external store so showing/clearing a toast only re-renders
// <Toast />, not the whole shell. `notify` is a stable module function.
let toastText = "";
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<() => void>();
function setToast(text: string) {
  toastText = text;
  toastListeners.forEach((listener) => listener());
}
function notify(text: string) {
  setToast(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToast(""), 3800);
}
function subscribeToast(listener: () => void) {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}
function Toast() {
  const text = useSyncExternalStore(
    subscribeToast,
    () => toastText,
    () => "",
  );
  const ref = useRef<HTMLDivElement>(null);
  // A manual popover sits in the top layer, so the toast stays readable above
  // an open modal dialog and its backdrop (where most toasts are triggered).
  useEffect(() => {
    const el = ref.current;
    if (el && typeof el.showPopover === "function" && !el.matches(":popover-open"))
      el.showPopover();
  }, [text]);
  return text ? (
    <div id="toast" ref={ref} popover="manual" role="status">
      {text}
    </div>
  ) : null;
}

export function LineupApp() {
  const page = pages[usePathname()] || "movies";
  // Direction of the last page change in tab order ("none" on first load), so
  // the incoming view shifts in from the side of the tab that was tapped.
  const [view, setView] = useState({ page, dir: "none" });
  if (view.page !== page) {
    const order = (p: Page) => nav.findIndex(([id]) => id === p);
    setView({ page, dir: order(page) > order(view.page) ? "forward" : "back" });
  }
  const [status, setStatus] = useState<AuthStatus | null>(null),
    [state, setState] = useState<State | null>(null),
    [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState(""),
    [active, setActive] = useState<Active | null>(null),
    [inbox, setInbox] = useState(false),
    // Unread ids captured as the inbox opens (opening marks them read).
    [unread, setUnread] = useState<Set<string>>(() => new Set());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // View state that survives switching between pages.
  const [upcomingView, setUpcomingView] = useState(defaultView),
    [searchMemory, setSearchMemory] = useState(emptySearch);
  const selection = useRef(0);
  const lookup = useMemo(() => (state ? buildLookup(state) : null), [state]);
  const reset = useCallback(() => {
    clearCache();
    setActive(null);
    setInbox(false);
    setState(null);
    setUser(null);
    setSearchMemory(emptySearch);
    setUpcomingView(defaultView);
    setStatus(signedOut);
  }, []);
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) reset();
      notify(message(err));
    },
    [reset],
  );
  const refresh = useCallback(async () => {
    const { user: account, state: data } = split(await api<Loaded>("state"));
    setState(data);
    if (account) writeCache(account, data);
    return data;
  }, []);
  // Opens from the saved copy when there is one, then from one /api/state
  // request; only a signed-out visitor needs the auth status (setup or sign-in).
  const boot = useCallback(async () => {
    setError("");
    const cached = readCache();
    if (cached) {
      setUser(cached.user);
      setState(cached.state);
      setStatus({ ...signedOut, authenticated: true, user: cached.user });
    }
    const pending = firstLoad || api<Loaded>("state");
    firstLoad = null;
    try {
      const { user: account, state: data } = split(await pending);
      if (!account) throw new ApiError("Sign in to access your Lineup.", 401);
      setUser(account);
      setState(data);
      setStatus({ ...signedOut, authenticated: true, user: account });
      writeCache(account, data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearCache();
        setState(null);
        try {
          const auth = await api<AuthStatus>("auth/status");
          setStatus(auth);
          setUser(auth.user);
        } catch (e) {
          setError(message(e));
        }
      } else if (cached) notify(message(err));
      else setError(message(err));
    }
  }, []);
  useEffect(() => {
    void boot();
  }, [boot]);
  async function signedIn(account: User) {
    setUser(account);
    await refresh();
    setStatus({ ...signedOut, authenticated: true, user: account });
  }
  async function signOut() {
    try {
      await api("auth/logout", "POST", {});
      reset();
    } catch (err) {
      fail(err);
    }
  }
  // Stable so memoised cards don't re-render when the shell does.
  const selectTitle = useCallback(
    async (title: Title) => {
      const n = ++selection.current;
      setActive({ title });
      try {
        const detail = await api<Detail>(
          "titles/" + encodeURIComponent(title.id),
        );
        if (selection.current === n) setActive(detail);
      } catch (err) {
        if (selection.current === n) setActive({ title, releases: null });
        fail(err);
      }
    },
    [fail],
  );
  // Opens from current state with no refetch: unread items are remembered for
  // the open inbox, marked read locally, and the server is told in the
  // background.
  async function openInbox() {
    if (!state) return;
    const ids = state.notifications.filter((n) => !n.read).map((n) => n.id);
    setUnread(new Set(ids));
    setInbox(true);
    if (!ids.length) return;
    setState(
      (s) =>
        s && {
          ...s,
          notifications: s.notifications.map((n) =>
            n.read ? n : { ...n, read: true },
          ),
        },
    );
    // Only the notifications shown as unread are marked, so one arriving meanwhile stays new.
    api("notifications/read", "POST", { ids }).catch(fail);
  }
  if (error)
    return (
      <section className="auth-screen">
        <div className="auth-card">
          <Brand />
          <h1>Unable to connect.</h1>
          <p>{error}</p>
          <button onClick={() => void boot()}>Try again</button>
        </div>
      </section>
    );
  if (!status || (status.authenticated && !state))
    return (
      <section className="auth-screen" aria-busy="true">
        <div className="auth-card">
          <Brand />
          <p>Opening Lineup…</p>
        </div>
      </section>
    );
  if (!status.authenticated || !user || !state || !lookup)
    return (
      <>
        <AuthPanel
          setup={status.setupRequired}
          setupKeyRequired={status.setupKeyRequired}
          onSignedIn={signedIn}
        />
        <Toast />
      </>
    );
  const market = state.settings.market;
  const { unreadCount, followingCount } = lookup;
  const navLink = ([id, href, icon, label]: (typeof nav)[number]) => (
    <Link
      key={id}
      href={href}
      className={
        (id === "settings" ? "settings-link " : "") +
        (page === id ? "active" : "")
      }
      aria-current={page === id ? "page" : undefined}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {id === "following" && followingCount > 0 && <b>{followingCount}</b>}
    </Link>
  );
  return (
    <>
      <div className="shell">
        <aside>
          <Link href="/" className="brand-link" aria-label="Lineup home">
            <Brand />
          </Link>
          {/* One nav, Settings included: it is pinned to the sidebar bottom on
              desktop and is the last tab on mobile. The Tracking panel sits
              between the pages and Settings (hidden on mobile). */}
          <nav>
            {nav.slice(0, -1).map(navLink)}
            <Library
              state={state}
              lookup={lookup}
              activeId={active?.title.id}
              onSelect={selectTitle}
            />
            {navLink(nav[nav.length - 1])}
          </nav>
          <div className="aside-bottom">
            <div className="profile" title={user.email}>
              <span aria-hidden="true">
                {user.email.slice(0, 1).toUpperCase()}
              </span>
              <span className="profile-name">{user.email}</span>
            </div>
          </div>
        </aside>
        <main>
          <header>
            <div className="header-actions">
              {/* Compact market control: the visible code is decorative; the
                  transparent native select on top keeps full option names. */}
              <span className="market">
                <Icon name="globe" size={14} />
                <span aria-hidden="true">{market}</span>
                <select
                  aria-label="Release market"
                  value={market}
                  onChange={async (e) => {
                    try {
                      await api("settings", "PATCH", {
                        ...state.settings,
                        market: e.target.value,
                      });
                      await refresh();
                    } catch (err) {
                      fail(err);
                    }
                  }}
                >
                  {Object.entries(countries).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </span>
              <button
                aria-label={
                  unreadCount
                    ? `Notifications, ${unreadCount} unread`
                    : "Notifications"
                }
                className="icon-button"
                onClick={() => void openInbox()}
              >
                <Bell />
                {unreadCount > 0 && <i aria-hidden="true" />}
              </button>
            </div>
          </header>
          <div id="content" key={page} data-dir={view.dir}>
            {page === "movies" || page === "tv" ? (
              <Upcoming
                kind={page === "tv" ? "tv" : "movie"}
                state={state}
                lookup={lookup}
                month={month}
                setMonth={setMonth}
                view={upcomingView}
                setView={setUpcomingView}
                onSelect={selectTitle}
                onError={fail}
              />
            ) : page === "search" ? (
              <SearchPage
                state={state}
                lookup={lookup}
                memory={searchMemory}
                onSearched={setSearchMemory}
                onSelect={selectTitle}
                onError={fail}
              />
            ) : page === "following" ? (
              <Following state={state} lookup={lookup} onSelect={selectTitle} />
            ) : (
              <SettingsPage
                state={state}
                user={user}
                refresh={refresh}
                onSignOut={signOut}
                openInbox={openInbox}
                notify={notify}
                onError={fail}
              />
            )}
          </div>
        </main>
      </div>
      {active && (
        <TitleDetails
          key={active.title.id}
          title={active.title}
          releases={active.releases}
          state={state}
          refresh={refresh}
          onClose={() => {
            selection.current++;
            setActive(null);
          }}
          notify={notify}
          onError={fail}
        />
      )}
      {inbox && (
        <Modal label="Notifications" onClose={() => setInbox(false)}>
          <div className="dialog-top">
            <h2>Notifications</h2>
            <button
              className="icon-button"
              aria-label="Close inbox"
              onClick={() => setInbox(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          {state.notifications.length ? (
            <>
              <ul className="sheet-list">
                {state.notifications
                  .slice()
                  .reverse()
                  .map((n) => {
                    // Unfollowed titles are no longer stored; they open from TMDB.
                    const t =
                      lookup.titles.get(n.titleId) ||
                      (n.titleName && /^tmdb-(movie|tv)-[0-9]+$/.test(n.titleId)
                        ? ({
                            id: n.titleId,
                            name: n.titleName,
                            mediaType: n.titleId.startsWith("tmdb-tv-")
                              ? "tv"
                              : "movie",
                          } as Title)
                        : undefined);
                    const body = (
                      <>
                        <span className="sheet-title">
                          {t?.name || n.titleName || "Release update"}
                          {unread.has(n.id) && (
                            <i className="unread">
                              <span className="sr-only">New</span>
                            </i>
                          )}
                        </span>
                        <span className="sheet-meta">
                          {[
                            kinds[n.kind] || n.kind,
                            shortDate(n.date),
                            n.medium === "theatrical"
                              ? "In cinemas"
                              : n.medium === "digital"
                                ? "Digital"
                                : n.service || "Streaming",
                          ].join(" · ")}
                        </span>
                      </>
                    );
                    return (
                      <li key={n.id}>
                        {t ? (
                          <button
                            className="sheet-item"
                            onClick={() => {
                              setInbox(false);
                              void selectTitle(t);
                            }}
                          >
                            {body}
                          </button>
                        ) : (
                          <div className="sheet-item">{body}</div>
                        )}
                      </li>
                    );
                  })}
              </ul>
              <p className="sheet-note">
                Reminders mean a release is scheduled, not verified available.
              </p>
            </>
          ) : (
            <Empty title="Quiet for now.">
              Follow a title to get date announcements and reminders here.
            </Empty>
          )}
        </Modal>
      )}
      <Toast />
    </>
  );
}
