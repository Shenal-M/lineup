"use client";
import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import { AuthPanel } from "./AuthPanel";
import { Brand, Bell, Modal, Empty } from "./ui";
import { Upcoming, SearchPage, Following } from "./pages";
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
export function LineupApp({ page }: { page: Page }) {
  const [status, setStatus] = useState<AuthStatus | null>(null),
    [state, setState] = useState<State | null>(null),
    [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [active, setActive] = useState<Title | null>(null),
    [inbox, setInbox] = useState(false);
  const [month, setMonth] = useState(new Date(2026, 10, 1));
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    selection = useRef(0);
  const notify = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3800);
  }, []);
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setState(null);
        setActive(null);
        setInbox(false);
        setStatus({
          setupRequired: false,
          setupKeyRequired: false,
          authenticated: false,
          user: null,
        });
      }
      notify(message(err));
    },
    [notify],
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
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [boot]);
  async function signedIn(account: User) {
    setUser(account);
    await refresh();
    setStatus({
      setupRequired: false,
      setupKeyRequired: false,
      authenticated: true,
      user: account,
    });
  }
  async function signOut() {
    await api("auth/logout", "POST", {});
    setActive(null);
    setInbox(false);
    setState(null);
    setUser(null);
    setStatus({
      setupRequired: false,
      setupKeyRequired: false,
      authenticated: false,
      user: null,
    });
  }
  async function selectTitle(title: Title) {
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
  }
  async function openInbox() {
    try {
      await refresh();
      setInbox(true);
      await api("notifications/read", "POST", {});
      await refresh();
    } catch (err) {
      fail(err);
    }
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
  if (!status.authenticated || !user || !state)
    return (
      <AuthPanel
        setup={status.setupRequired}
        setupKeyRequired={status.setupKeyRequired}
        onSignedIn={signedIn}
      />
    );
  const market = state.settings.market;
  const nav = [
    ["upcoming", "/", "▦", "Upcoming"],
    ["search", "/search", "⌕", "Search"],
    ["following", "/following", "♡", "Following"],
  ] as const;
  return (
    <>
      <div className="shell">
        <aside>
          <Link href="/" aria-label="Lineup home">
            <Brand />
          </Link>
          <p className="nav-label">YOUR RELEASE TRACKER</p>
          <nav>
            {nav.map(([id, href, icon, label]) => (
              <Link
                key={id}
                href={href}
                className={page === id ? "active" : ""}
                aria-current={page === id ? "page" : undefined}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
                {id === "following" && (
                  <b>
                    {new Set(state.subscriptions.map((s) => s.titleId)).size}
                  </b>
                )}
              </Link>
            ))}
            <Link
              href="/settings"
              className={`settings-link ${page === "settings" ? "active" : ""}`}
              aria-label="Settings"
            >
              <span>⚙</span>
            </Link>
          </nav>
          <div className="aside-bottom">
            <Link
              href="/settings"
              className={page === "settings" ? "active" : ""}
            >
              ⚙ &nbsp; Settings
            </Link>
            <div className="profile">
              <span>{user.email.slice(0, 1).toUpperCase()}</span>
              <div>
                <span className="profile-name">{user.email}</span>
                <small>Personal account</small>
              </div>
            </div>
          </div>
        </aside>
        <main>
          <header>
            <div className="breadcrumb">MOVIES & TV, ON YOUR SCHEDULE</div>
            <div className="header-actions">
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
                    {v} · {label}
                  </option>
                ))}
              </select>
              <button
                aria-label="Open notifications"
                className="icon-button"
                onClick={() => void openInbox()}
              >
                <Bell />
                {state.notifications.some((n) => !n.read) && <i />}
              </button>
            </div>
          </header>
          <div id="content">
            {page === "upcoming" ? (
              <Upcoming
                state={state}
                month={month}
                setMonth={setMonth}
                onSelect={selectTitle}
              />
            ) : page === "search" ? (
              <SearchPage
                state={state}
                refresh={refresh}
                onSelect={selectTitle}
                onError={fail}
              />
            ) : page === "following" ? (
              <Following state={state} onSelect={selectTitle} />
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
          <footer>
            Lineup · Personal release tracker{" "}
            <span>Dates belong to the selected release market.</span>
          </footer>
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
            <h2>Your release radar</h2>
            <button aria-label="Close inbox" onClick={() => setInbox(false)}>
              ×
            </button>
          </div>
          <p>
            Scheduled reminders say a release is scheduled, not verified
            available.
          </p>
          {state.notifications.length ? (
            state.notifications
              .slice()
              .reverse()
              .map((n) => (
                <div className="notify-item" key={n.id}>
                  <strong>
                    {state.titles.find((t) => t.id === n.titleId)?.name ||
                      "Release update"}
                  </strong>
                  <small>
                    {(
                      {
                        announced: "A date has been added",
                        changed: "Release details changed",
                        week: "Scheduled in 7 days",
                        day: "Scheduled tomorrow",
                        release: "Scheduled for today",
                      } as Record<string, string>
                    )[n.kind] || n.kind}{" "}
                    · {n.date || "TBA"} · {n.service || n.medium}
                  </small>
                </div>
              ))
          ) : (
            <Empty title="Quiet for now.">
              Follow a release to receive date announcements, changes, and
              scheduled reminders here.
            </Empty>
          )}
        </Modal>
      )}
      {toast && (
        <div id="toast" className="visible" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
