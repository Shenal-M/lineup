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
import {
  Upcoming,
  SearchPage,
  Following,
  buildLookup,
  type SearchMemory,
  type UpcomingView,
} from "./pages";
import { SettingsPage } from "./SettingsPage";
import { TitleDetails } from "./TitleDetails";
import {
  api,
  ApiError,
  message,
  countries,
  type State,
  type Title,
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
  "/search": "search",
  "/following": "following",
  "/settings": "settings",
};
const nav = [
  ["upcoming", "/", "calendar", "Upcoming"],
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
const defaultView: UpcomingView = { filter: "all", layout: "list" };

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
  const page = pages[usePathname()] || "upcoming";
  const [status, setStatus] = useState<AuthStatus | null>(null),
    [state, setState] = useState<State | null>(null),
    [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState(""),
    [active, setActive] = useState<Title | null>(null),
    [inbox, setInbox] = useState(false),
    // Unread ids captured as the inbox opens (opening marks them read).
    [unread, setUnread] = useState<Set<string>>(() => new Set());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // View state that survives switching between Upcoming/Search.
  const [upcomingView, setUpcomingView] = useState(defaultView),
    [searchMemory, setSearchMemory] = useState(emptySearch);
  const selection = useRef(0);
  const lookup = useMemo(() => (state ? buildLookup(state) : null), [state]);
  const reset = useCallback(() => {
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
    const data = await api<State>("state");
    setState(data);
    return data;
  }, []);
  const boot = useCallback(async () => {
    setError("");
    try {
      const auth = await api<AuthStatus>("auth/status");
      setStatus(auth);
      setUser(auth.user);
      if (auth.authenticated) await refresh();
    } catch (err) {
      setError(message(err));
    }
  }, [refresh]);
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
      setActive(title);
      if (!title.id.includes("-season-")) {
        try {
          const fresh = await api<Title>(
            "titles/" + encodeURIComponent(title.id),
          );
          if (selection.current === n) setActive(fresh);
        } catch (err) {
          fail(err);
        }
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
  return (
    <>
      <div className="shell">
        <aside>
          <Link href="/" className="brand-link" aria-label="Lineup home">
            <Brand />
          </Link>
          {/* One nav, Settings included: it is pinned to the sidebar bottom on
              desktop and is the last tab on mobile. */}
          <nav>
            {nav.map(([id, href, icon, label]) => (
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
                {id === "following" && followingCount > 0 && (
                  <b>{followingCount}</b>
                )}
              </Link>
            ))}
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
          <div id="content" key={page}>
            {page === "upcoming" ? (
              <Upcoming
                state={state}
                lookup={lookup}
                month={month}
                setMonth={setMonth}
                view={upcomingView}
                setView={setUpcomingView}
                onSelect={selectTitle}
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
                month={month}
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
          key={active.id}
          title={active}
          state={state}
          refresh={refresh}
          setTitle={setActive}
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
                    const t = lookup.titles.get(n.titleId);
                    const body = (
                      <>
                        <span className="sheet-title">
                          {t?.name || "Release update"}
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
                            n.service ||
                              (n.medium === "theatrical"
                                ? "In cinemas"
                                : "Streaming"),
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
