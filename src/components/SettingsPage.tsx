"use client";
import { useState, type FormEvent } from "react";
import { Heading } from "./ui";
import { api, countries, type State, type User } from "./types";
type Props = {
  state: State;
  user: User;
  month: Date;
  refresh: () => Promise<State>;
  onSignOut: () => Promise<void>;
  openInbox: () => Promise<void>;
  notify: (s: string) => void;
  onError: (e: unknown) => void;
};
export function SettingsPage({
  state,
  user,
  month,
  refresh,
  onSignOut,
  openInbox,
  notify,
  onError,
}: Props) {
  const [busy, setBusy] = useState("");
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
      notify("Password updated. Other devices have been signed out.");
    } catch (error) {
      onError(error);
    } finally {
      setBusy("");
    }
  }
  async function importDates() {
    setBusy("import");
    try {
      const r = await api<{ count: number }>("import", "POST", {
        market: state.settings.market,
        from: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`,
      });
      await refresh();
      notify(`Imported ${r.count} regional release events`);
    } catch (error) {
      await refresh().catch(() => {});
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
  return (
    <>
      <Heading
        title="Settings."
        subtitle="Choose your release market and reminder preferences."
      />
      <div className="settings-grid">
        <div>
          <fieldset className="account-settings">
            <legend>Your account</legend>
            <div className="account-summary">
              <div>
                <strong>{user.email}</strong>
                <small>
                  Follows, settings, and dates saved on this server.
                </small>
              </div>
              <button onClick={() => onSignOut().catch(onError)}>
                Sign out
              </button>
            </div>
            <details>
              <summary>Change password</summary>
              <form onSubmit={password}>
                <label htmlFor="current-password">Current password</label>
                <input
                  id="current-password"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
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
                />
                <p className="fineprint">
                  Changing your password signs out your other devices.
                </p>
                <button className="primary" disabled={busy === "password"}>
                  Update password
                </button>
              </form>
            </details>
          </fieldset>
          <form key={JSON.stringify(state.settings)} onSubmit={save}>
            <fieldset>
              <legend>Release preferences</legend>
              <label htmlFor="pref-market">Release market</label>
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
              <p>
                Market selection never falls back to another country. Sri Lankan
                release coverage requires your own local sources.
              </p>
              <label htmlFor="timezone">Reminder timezone</label>
              <select
                id="timezone"
                name="timezone"
                defaultValue={state.settings.timezone}
              >
                {timezones.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <label htmlFor="hour">Reminder hour (24-hour)</label>
              <input
                id="hour"
                name="hour"
                type="number"
                min={0}
                max={23}
                defaultValue={state.settings.hour}
                required
              />
              <p>
                Date-only releases stay on the market calendar day. Reminder
                checks use this timezone.
              </p>
              <button className="primary" disabled={busy === "settings"}>
                Save preferences
              </button>
            </fieldset>
          </form>
          <fieldset>
            <legend>Notifications</legend>
            <p>
              In-app reminders follow your selected channels and reminder rules.
              Scheduled email checks use your reminder timezone.
            </p>
            <p>
              {state.sources.email
                ? `Email delivery is configured for ${user.email}. Scheduled checks must be enabled to send reminders while the app is closed.`
                : "Email delivery is not configured yet."}
            </p>
            <p>Phone push and weekly digests are not connected.</p>
            <button onClick={() => openInbox().catch(onError)}>
              Open notification inbox →
            </button>
          </fieldset>
        </div>
        <div>
          <fieldset>
            <legend>Data connections</legend>
            <div className="source-row">
              <span>TMDB · catalogue & theatrical dates</span>
              <span className={`badge ${state.sources.tmdb ? "" : "off"}`}>
                {state.sources.tmdb ? "Configured" : "Not connected"}
              </span>
            </div>
            <div className="source-row">
              <span>Streaming premiere feed</span>
              <span className="badge off">Not connected</span>
            </div>
            <div className="source-row">
              <span>Manual announcements</span>
              <span className="badge">Ready</span>
            </div>
            <p>
              Set TMDB_TOKEN on the server and restart to enable live search and
              theatrical imports. Credentials never go in the browser.
            </p>
            <p>
              Streaming dates can be added in a title’s details, with a source.
              Provider-feed integration remains to be built.
            </p>
            <button
              disabled={!state.sources.tmdb || busy === "import"}
              onClick={() => void importDates()}
            >
              {busy === "import"
                ? "Importing regional dates…"
                : `Import theatrical dates · ${month.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`}
            </button>
            {state.health.map((h) => (
              <p key={h.id}>
                {h.id} · {h.state} · {h.note}
                <small>{h.updatedAt}</small>
              </p>
            ))}
            <p className="fineprint">
              Live catalogue metadata and images: TMDB. This product uses the
              TMDB API but is not endorsed or certified by TMDB. Official logo
              attribution must be added before public launch.
            </p>
          </fieldset>
          <fieldset>
            <legend>About this build</legend>
            <p>
              Lineup is a personal release tracker built with Next.js and React.
              Sample titles, dates, and service associations are labelled and
              are not verified.
            </p>
            <p>
              Follows, settings, release history, and notifications live in a
              server database. Keep database backups.
            </p>
          </fieldset>
        </div>
      </div>
    </>
  );
}
