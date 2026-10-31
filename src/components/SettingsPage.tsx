"use client";
import { useState, type FormEvent } from "react";
import { Heading } from "./ui";
import { api, countries, type State, type User } from "./types";
type Props = {
  state: State;
  user: User;
  refresh: () => Promise<State>;
  onSignOut: () => Promise<void>;
  openInbox: () => Promise<void>;
  notify: (s: string) => void;
  onError: (e: unknown) => void;
};
type Tone = "on" | "off" | "error";
const healthNames: Record<string, string> = {
  tmdb: "TMDB check",
  scheduler: "Reminder scheduler",
};
// Quiet one-liners for healthy background jobs.
const healthDone: Record<string, string> = {
  tmdb: "Followed titles checked",
  scheduler: "Reminders checked",
};
const hours = Array.from({ length: 24 }, (_, h) => [
  h,
  `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`,
]) as [number, string][];
function ago(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return `on ${when(iso)}`;
}
function Status({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={`status ${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
export function SettingsPage({
  state,
  user,
  refresh,
  onSignOut,
  openInbox,
  notify,
  onError,
}: Props) {
  const [busy, setBusy] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy("settings");
    try {
      await api("settings", "PATCH", {
        market: data.get("market"),
        timezone: data.get("timezone"),
        hour: Number(data.get("hour")),
      });
      await refresh();
      notify("Preferences saved");
    } catch (error) {
      onError(error);
    } finally {
      setBusy("");
    }
  }
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy("password");
    try {
      await api("auth/password", "POST", Object.fromEntries(data));
      form.reset();
      setChangingPassword(false);
      notify("Password updated. Other devices have been signed out.");
    } catch (error) {
      onError(error);
    } finally {
      setBusy("");
    }
  }
  const timezones = [
    ...new Set([
      "Asia/Colombo",
      "UTC",
      "America/New_York",
      "Europe/London",
      "Asia/Kolkata",
      state.settings.timezone,
    ]),
  ];
  // Failures get a full row; healthy jobs collapse into one quiet line.
  const failing = state.health.filter((h) => h.state === "error"),
    quiet = state.health.filter((h) => h.state !== "error");
  return (
    <>
      <Heading title="Settings" />
      <div className="settings">
        <section className="settings-section" aria-labelledby="settings-prefs">
          <h2 id="settings-prefs">Preferences</h2>
          <form
            key={JSON.stringify(state.settings)}
            onSubmit={save}
            className="settings-list"
          >
            <div className="settings-row">
              <div className="settings-label">
                <label htmlFor="pref-market">Release market</label>
                <small>Dates never fall back to another country.</small>
              </div>
              <div className="settings-control">
                <select
                  id="pref-market"
                  name="market"
                  defaultValue={state.settings.market}
                >
                  {Object.entries(countries).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <label htmlFor="timezone">Reminder timezone</label>
              </div>
              <div className="settings-control">
                <select
                  id="timezone"
                  name="timezone"
                  defaultValue={state.settings.timezone}
                >
                  {timezones.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <label htmlFor="hour">Reminder time</label>
                <small>In your reminder timezone.</small>
              </div>
              <div className="settings-control">
                <select
                  id="hour"
                  name="hour"
                  defaultValue={String(state.settings.hour)}
                >
                  {hours.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-actions">
              <button className="primary" disabled={busy === "settings"}>
                {busy === "settings" ? "Saving…" : "Save preferences"}
              </button>
            </div>
          </form>
        </section>

        <section className="settings-section" aria-labelledby="settings-sources">
          <h2 id="settings-sources">Data sources</h2>
          <ul className="settings-list">
            <li className="settings-row">
              <div className="settings-label">
                <span className="settings-name">TMDB</span>
                <small>
                  {state.sources.tmdb
                    ? "Search, upcoming releases and dates. Followed titles are re-checked twice a day."
                    : "Set TMDB_TOKEN on the server to enable."}
                </small>
              </div>
              <Status tone={state.sources.tmdb ? "on" : "off"}>
                {state.sources.tmdb ? "Connected" : "Not connected"}
              </Status>
            </li>
            <li className="settings-row">
              <div className="settings-label">
                <span className="settings-name">Email reminders</span>
                <small>
                  {state.sources.email
                    ? `Sent to ${user.email}.`
                    : "Not configured on the server."}
                </small>
              </div>
              <Status tone={state.sources.email ? "on" : "off"}>
                {state.sources.email ? "Connected" : "Not connected"}
              </Status>
            </li>
            {failing.map((h) => (
              <li className="settings-row is-error" key={h.id}>
                <div className="settings-label">
                  <span className="settings-name">
                    {healthNames[h.id] ?? h.id}
                  </span>
                  <small>{h.note || "The last run failed."}</small>
                </div>
                <div className="settings-value">
                  <Status tone="error">Error</Status>
                  <time className="settings-time" dateTime={h.updatedAt}>
                    {when(h.updatedAt)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
          {quiet.length > 0 && (
            <p className="settings-health">
              {quiet.map((h, i) => (
                <span key={h.id} title={h.note || undefined}>
                  {i > 0 && " · "}
                  {h.state === "ok"
                    ? `${healthDone[h.id] ?? healthNames[h.id] ?? h.id} `
                    : `${healthNames[h.id] ?? h.id}: ${h.state}, `}
                  <time dateTime={h.updatedAt} suppressHydrationWarning>
                    {ago(h.updatedAt)}
                  </time>
                </span>
              ))}
            </p>
          )}
          <p className="fineprint">
            Uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </section>

        <section className="settings-section" aria-labelledby="settings-account">
          <h2 id="settings-account">Account</h2>
          <div className="settings-list">
            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-name">Email</span>
              </div>
              <span className="settings-email">{user.email}</span>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-name">Notifications</span>
              </div>
              <div className="settings-control">
                <button onClick={() => openInbox().catch(onError)}>
                  Open inbox
                </button>
              </div>
            </div>
            <div className="settings-row settings-row-wrap">
              <div className="settings-label">
                <span className="settings-name">Password</span>
                <small>Changing it signs out your other devices.</small>
              </div>
              <div className="settings-control">
                <button
                  aria-expanded={changingPassword}
                  aria-controls={
                    changingPassword ? "password-panel" : undefined
                  }
                  onClick={() => setChangingPassword((v) => !v)}
                >
                  {changingPassword ? "Cancel" : "Change password"}
                </button>
              </div>
              {changingPassword && (
                <form
                  id="password-panel"
                  className="password-panel"
                  onSubmit={password}
                >
                  <label htmlFor="current-password">Current password</label>
                  <input
                    id="current-password"
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={256}
                    autoFocus
                  />
                  <label htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={256}
                    required
                    placeholder="At least 12 characters"
                  />
                  <button className="primary" disabled={busy === "password"}>
                    {busy === "password" ? "Updating…" : "Update password"}
                  </button>
                </form>
              )}
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-name">Sign out</span>
                <small>Sign out on this device.</small>
              </div>
              <div className="settings-control">
                <button onClick={() => onSignOut().catch(onError)}>
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
