"use client";
import { useRef, useState, type FormEvent } from "react";
import { Bell, Modal, Poster } from "./ui";
import {
  api,
  countries,
  dateLabel,
  defaultRules,
  rules,
  services,
  type State,
  type Title,
  type Release,
  type Subscription,
} from "./types";
import type { Medium } from "../model";
type Props = {
  title: Title;
  state: State;
  refresh: () => Promise<State>;
  setTitle: (t: Title) => void;
  onClose: () => void;
  notify: (s: string) => void;
  onError: (e: unknown) => void;
};
export function TitleDetails({
  title: t,
  state,
  refresh,
  setTitle,
  onClose,
  notify,
  onError,
}: Props) {
  const [editor, setEditor] = useState<Release | null | undefined>(undefined),
    [busy, setBusy] = useState("");
  const other = useRef<HTMLDetailsElement>(null);
  const market = state.settings.market,
    events = state.releases.filter(
      (e) => e.titleId === t.id && e.market === market,
    );
  const subscriptions = state.subscriptions.filter(
    (s) => s.titleId === t.id && s.market === market,
  );
  const [selectedRules, setSelectedRules] = useState<string[]>(
    subscriptions[0]?.rules || defaultRules,
  );
  function selected(medium: Medium, service: string | null) {
    return subscriptions.filter(
      (s) =>
        s.medium === medium &&
        (service ? s.services.includes(service) : !s.services.length),
    );
  }
  async function toggle(medium: Medium, service: string | null) {
    const existing = selected(medium, service);
    setBusy(`${medium}:${service}`);
    try {
      if (existing.length) {
        for (const s of existing) {
          const rest = service ? s.services.filter((x) => x !== service) : [];
          if (rest.length)
            await api("subscriptions", "POST", { ...s, services: rest });
          else await api("subscriptions/" + encodeURIComponent(s.id), "DELETE");
        }
      } else
        await api("subscriptions", "POST", {
          titleId: t.id,
          market,
          medium,
          services: service ? [service] : [],
          rules: subscriptions[0]?.rules || selectedRules,
          scope: "channel",
        });
      await refresh();
      if (other.current) other.current.open = false;
      notify(
        existing.length
          ? "Channel notifications turned off"
          : "Channel notifications turned on",
      );
    } catch (error) {
      onError(error);
    } finally {
      setBusy("");
    }
  }
  async function saveRules(e: FormEvent) {
    e.preventDefault();
    if (!subscriptions.length) {
      notify("Follow a channel first, then customize its notifications.");
      return;
    }
    setBusy("rules");
    try {
      for (const s of subscriptions)
        await api("subscriptions", "POST", { ...s, rules: selectedRules });
      await refresh();
      notify("Notification preferences saved");
    } catch (error) {
      onError(error);
    } finally {
      setBusy("");
    }
  }
  async function season(number: string) {
    if (!number) return;
    setBusy("season");
    try {
      const title = await api<Title>(
        `titles/${encodeURIComponent(t.id)}/seasons/${number}`,
      );
      await refresh();
      setTitle(title);
    } catch (error) {
      onError(error);
    } finally {
      setBusy("");
    }
  }
  function channelRow(
    medium: Medium,
    service: string | null,
    dates: Release[],
    label = service || "In cinemas",
  ) {
    const on = selected(medium, service).length > 0;
    return (
      <div className="channel-row" key={`${medium}:${service}`}>
        <span className="channel-monogram" aria-hidden="true">
          {medium === "theatrical" ? "▤" : service ? service.slice(0, 1) : "◎"}
        </span>
        <span className="channel-name">{label}</span>
        <div className="channel-dates">
          {dates.length ? (
            dates.map((e) => (
              <div key={e.id} className="channel-date">
                <span className={e.date ? "" : "date-tba"}>{dateLabel(e)}</span>
                {e.date &&
                  [
                    "estimated",
                    "postponed",
                    "cancelled",
                    "first_observed",
                  ].includes(e.status) && (
                    <small
                      className={`date-status ${e.status === "estimated" ? "estimated" : ""}`}
                    >
                      {e.status.replace("_", " ")}
                    </small>
                  )}
              </div>
            ))
          ) : (
            <span className="date-tba">Date TBA</span>
          )}
        </div>
        <button
          className={`channel-toggle ${on ? "is-on" : ""}`}
          disabled={!!busy}
          aria-pressed={on}
          aria-label={`Notifications for ${label}`}
          onClick={() => void toggle(medium, service)}
        >
          <Bell />
          <span>{on ? "Following" : "Notify me"}</span>
        </button>
      </div>
    );
  }
  const shownServices = [
    ...new Set([
      ...events
        .filter((e) => e.medium === "streaming" && e.service)
        .map((e) => e.service!),
      ...subscriptions
        .filter((s) => s.medium === "streaming")
        .flatMap((s) => s.services),
    ]),
  ];
  const extraServices = services.filter((s) => !shownServices.includes(s));
  const tags = [
    t.mediaType === "tv" ? "TV series" : "Movie",
    t.year,
    ...(t.genre || "").split(" · "),
  ].filter(Boolean);
  if (editor !== undefined)
    return (
      <Modal label="Edit release" onClose={onClose}>
        <ReleaseEditor
          event={editor}
          title={t}
          market={market}
          onBack={() => setEditor(undefined)}
          onSaved={async () => {
            await refresh();
            setEditor(undefined);
            notify("Release saved with source history");
          }}
          onError={onError}
        />
      </Modal>
    );
  return (
    <Modal
      label={`${t.name} release details`}
      className="title-dialog"
      onClose={onClose}
    >
      <button
        className="detail-close"
        aria-label="Close details"
        onClick={onClose}
      >
        ×
      </button>
      <section className="title-overview">
        <div className="detail-poster">
          <Poster title={t} />
        </div>
        <div className="title-copy">
          {t.demo && <span className="sample-label">Sample title & dates</span>}
          <h2>{t.name}</h2>
          <div className="title-tags">
            {tags.map((tag, i) => (
              <span key={i}>{tag}</span>
            ))}
          </div>
          <p className="title-description">
            {t.synopsis || "No description available yet."}
          </p>
          {t.credit && <span className="title-credit">{t.credit}</span>}
          {!!t.seasons?.length && (
            <>
              <label className="sr-only" htmlFor="season-number">
                Season
              </label>
              <select
                id="season-number"
                defaultValue=""
                disabled={busy === "season"}
                onChange={(e) => void season(e.target.value)}
              >
                <option value="">Choose a season</option>
                {t.seasons.map((s) => (
                  <option key={s.number} value={s.number}>
                    {s.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </section>
      <section className="release-channels">
        <div className="channels-heading">
          <h3>Release dates</h3>
          <span>
            {market} · {countries[market]}
          </span>
        </div>
        {(t.mediaType !== "tv" ||
          events.some((e) => e.medium === "theatrical")) &&
          channelRow(
            "theatrical",
            null,
            events.filter((e) => e.medium === "theatrical"),
          )}
        {shownServices.map((service) =>
          channelRow(
            "streaming",
            service,
            events.filter(
              (e) => e.medium === "streaming" && e.service === service,
            ),
          ),
        )}
        {channelRow(
          "streaming",
          null,
          events.filter((e) => e.medium === "streaming" && !e.service),
          "Any streaming service",
        )}
        {extraServices.length > 0 && (
          <details className="other-channels" ref={other}>
            <summary>
              Track a specific streaming channel{" "}
              <span>+ {extraServices.length}</span>
            </summary>
            {extraServices.map((service) =>
              channelRow("streaming", service, []),
            )}
          </details>
        )}
        <p className="channel-hint">
          Tap the bell to follow a channel, even before a date is announced.
        </p>
      </section>
      <div className="detail-secondary">
        <details className="reminder-options">
          <summary>Notification preferences</summary>
          <form onSubmit={saveRules}>
            <div className="reminder-checks">
              {rules.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    value={value}
                    checked={selectedRules.includes(value)}
                    onChange={(e) =>
                      setSelectedRules((prev) =>
                        e.target.checked
                          ? [...prev, value]
                          : prev.filter((v) => v !== value),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <button className="primary" disabled={!!busy}>
              Save preferences
            </button>
          </form>
          <small>
            Delivered to your in-app inbox. Email and push are not connected.
          </small>
        </details>
        <details className="release-sources">
          <summary>Sources & date corrections</summary>
          {events.map((e) => (
            <div className="source-entry" key={e.id}>
              <div>
                <strong>
                  {e.service ||
                    (e.medium === "theatrical" ? "In cinemas" : "Streaming")}
                </strong>
                <small>
                  {e.source}
                  {e.sourceUrl && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={e.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Source ↗
                      </a>
                    </>
                  )}
                </small>
              </div>
              <button onClick={() => setEditor(e)}>Edit</button>
            </div>
          ))}
          <button className="text-button" onClick={() => setEditor(null)}>
            + Add release date
          </button>
        </details>
      </div>
      {!!t.episodes?.length && (
        <details className="episode-list">
          <summary>
            Episodes <span>{t.episodes.length}</span>
          </summary>
          {t.episodes.map((e) => (
            <div className="source-row" key={e.number}>
              <span>
                {e.number}. {e.name}
              </span>
              <small>{e.originalAirDate || "TBA"}</small>
            </div>
          ))}
          <small>Original air dates; local streaming dates may differ.</small>
        </details>
      )}
    </Modal>
  );
}
function ReleaseEditor({
  event,
  title,
  market,
  onBack,
  onSaved,
  onError,
}: {
  event: Release | null;
  title: Title;
  market: string;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [medium, setMedium] = useState<Medium>(event?.medium || "streaming"),
    [precision, setPrecision] = useState(event?.precision || "unknown"),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(
        "releases" + (event ? "/" + event.id : ""),
        event ? "PATCH" : "POST",
        {
          ...Object.fromEntries(data),
          titleId: title.id,
          market,
          medium,
          precision,
          service: medium === "streaming" ? data.get("service") || null : null,
          offer: medium === "streaming" ? "subscription" : "ticket",
          date: precision === "unknown" ? null : data.get("date"),
        },
      );
      await onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="dialog-top">
        <h2>{event ? "Edit release" : "Add release"}</h2>
        <button onClick={onBack}>Back</button>
      </div>
      <p>
        Keep the date’s precision and source. Imports will preserve manual
        corrections.
      </p>
      <form onSubmit={save}>
        <div className="split">
          <div>
            <label htmlFor="medium">Category</label>
            <select
              id="medium"
              value={medium}
              onChange={(e) => setMedium(e.target.value as Medium)}
            >
              <option value="theatrical">Theatrical</option>
              <option value="streaming">Subscription streaming</option>
            </select>
          </div>
          <div>
            <label htmlFor="service">Service (optional)</label>
            <input
              id="service"
              name="service"
              defaultValue={event?.service || ""}
              maxLength={100}
              disabled={medium === "theatrical"}
            />
          </div>
          <div>
            <label htmlFor="precision">Precision</label>
            <select
              id="precision"
              value={precision}
              onChange={(e) =>
                setPrecision(e.target.value as Release["precision"])
              }
            >
              {["day", "month", "quarter", "year", "unknown"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="date">Date / start of period</label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={event?.date || ""}
              disabled={precision === "unknown"}
              required={precision !== "unknown"}
            />
          </div>
          <div>
            <label htmlFor="status">Status</label>
            <select
              id="status"
              name="status"
              defaultValue={event?.status || "announced"}
            >
              {[
                "announced",
                "estimated",
                "postponed",
                "cancelled",
                "first_observed",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
        <label htmlFor="source">Source note *</label>
        <input
          id="source"
          name="source"
          defaultValue={event?.source || ""}
          maxLength={500}
          required
        />
        <label htmlFor="source-url">Announcement URL</label>
        <input
          id="source-url"
          name="sourceUrl"
          type="url"
          defaultValue={event?.sourceUrl || ""}
        />
        <p className="fineprint">
          Month, quarter, and year boundaries are not release days. No
          release-day reminder is sent.
        </p>
        <button className="primary" disabled={busy}>
          Save release
        </button>
      </form>
    </>
  );
}
