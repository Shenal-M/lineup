"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { Bell, Icon, Modal, Poster } from "./ui";
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
// Titles (per market) with a follow change in flight. Module-level so the
// guard survives closing and reopening the dialog mid-request: two channels can
// share a subscription record, so a second POST/DELETE must wait.
const toggling = new Set<string>();
// A follow change saved but the refetch failed: the subscriptions list it was
// based on is stale, so the next toggle (in any remount) resyncs first.
const staleAgainst = new Map<string, State["subscriptions"]>();
const flaggedStatuses = [
  "estimated",
  "postponed",
  "cancelled",
  "first_observed",
];
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
    [busy, setBusy] = useState(""),
    // Optimistic bell state per channel while its request is in flight.
    [pending, setPending] = useState<Record<string, boolean>>({}),
    [expanded, setExpanded] = useState(false),
    [clamped, setClamped] = useState(false);
  const more = useRef<HTMLDetailsElement>(null),
    synopsis = useRef<HTMLParagraphElement>(null);
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
  useEffect(() => setExpanded(false), [t.id]);
  // Fresh subscriptions supersede optimistic bells kept after a failed refetch.
  useEffect(() => setPending({}), [state.subscriptions]);
  // Measure after the dialog opens (and on resize): only offer "More" when the
  // synopsis actually overflows its clamp.
  useEffect(() => {
    const el = synopsis.current;
    if (!el) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [t.id, t.synopsis]);
  function selected(medium: Medium, service: string | null) {
    return subscriptions.filter(
      (s) =>
        s.medium === medium &&
        (service ? s.services.includes(service) : !s.services.length),
    );
  }
  async function toggle(medium: Medium, service: string | null, extra = false) {
    // One change at a time per title, even across dialog remounts.
    const lock = `${t.id}:${market}`;
    if (toggling.has(lock) || busy) return;
    if (staleAgainst.get(lock) === state.subscriptions) {
      // Resync first; the bells re-render from fresh state for the next tap.
      refresh().catch(onError);
      return;
    }
    staleAgainst.delete(lock);
    toggling.add(lock);
    const existing = selected(medium, service),
      key = `${medium}:${service}`;
    setBusy(key);
    // Flip the bell now; the server round-trip confirms (or reverts) it.
    setPending((p) => ({ ...p, [key]: !existing.length }));
    let keepPending = false;
    try {
      try {
        if (existing.length)
          await Promise.all(
            existing.map((s) => {
              const rest = service
                ? s.services.filter((x) => x !== service)
                : [];
              return rest.length
                ? api("subscriptions", "POST", { ...s, services: rest })
                : api("subscriptions/" + encodeURIComponent(s.id), "DELETE");
            }),
          );
        else
          await api("subscriptions", "POST", {
            titleId: t.id,
            market,
            medium,
            services: service ? [service] : [],
            rules: subscriptions[0]?.rules || selectedRules,
            scope: "channel",
          });
      } catch (error) {
        // A partial failure may have changed some records; resync, then revert.
        await refresh().catch(() => {});
        onError(error);
        return;
      }
      notify(
        existing.length
          ? "Channel notifications turned off"
          : "Channel notifications turned on",
      );
      try {
        await refresh();
        // A newly tracked extra service moves up into the release list.
        if (extra && more.current) more.current.open = false;
      } catch (error) {
        // Saved, but the refetch failed: keep the optimistic bell (it matches
        // the server) and resync before the next change.
        staleAgainst.set(lock, state.subscriptions);
        keepPending = true;
        onError(error);
      }
    } finally {
      if (!keepPending)
        setPending((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
      toggling.delete(lock);
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
      await Promise.all(
        subscriptions.map((s) =>
          api("subscriptions", "POST", { ...s, rules: selectedRules }),
        ),
      );
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
    { label = service || "In cinemas", extra = false } = {},
  ) {
    const key = `${medium}:${service}`,
      on = pending[key] ?? selected(medium, service).length > 0;
    return (
      <li className="channel-row" key={key}>
        {service ? (
          <span className="channel-mark" aria-hidden="true">
            {service.slice(0, 1)}
          </span>
        ) : (
          <span
            className={`channel-mark is-dot ${medium}`}
            aria-hidden="true"
          />
        )}
        <span className="channel-name">{label}</span>
        {!extra && (
          <span className="channel-dates">
            {dates.length ? (
              dates.map((e) => (
                <span key={e.id} className="channel-date">
                  {e.date && flaggedStatuses.includes(e.status) && (
                    <small className="date-status">
                      {e.status.replace("_", " ")}
                    </small>
                  )}
                  {e.date ? (
                    dateLabel(e)
                  ) : (
                    <span className="date-tba">TBA</span>
                  )}
                </span>
              ))
            ) : (
              <span className="date-tba">TBA</span>
            )}
          </span>
        )}
        <button
          type="button"
          className={`bell-toggle ${on ? "is-on" : ""}`}
          aria-pressed={on}
          aria-busy={busy === key || undefined}
          aria-label={`Notifications for ${label}`}
          title={
            on ? "Following — tap to stop" : "Notify me, even before a date"
          }
          onClick={() => void toggle(medium, service, extra)}
        >
          <Bell on={on} />
        </button>
      </li>
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
  const meta = [
    t.mediaType === "tv" ? "TV" : "Movie",
    t.season ? `Season ${t.season}` : null,
    t.season && t.episodes?.length ? `${t.episodes.length} episodes` : null,
    t.season ? null : t.year,
    (t.genre || "").split(" · ").filter(Boolean).join(", "),
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
      <span className="sheet-handle" aria-hidden="true" />
      <button
        type="button"
        className="detail-close icon-button"
        aria-label="Close details"
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
      <div className="title-body">
        <section className="title-overview">
          <div className="detail-poster">
            <Poster title={t} />
          </div>
          <div className="title-copy">
            <div className="title-head">
              <h2>{t.name}</h2>
              {t.demo && <span className="sample-badge">Sample</span>}
            </div>
            {meta.length > 0 && (
              <p className="title-meta">{meta.join(" · ")}</p>
            )}
            {!!t.seasons?.length && (
              <div className="season-pick">
                <label className="sr-only" htmlFor="season-number">
                  Season
                </label>
                <select
                  id="season-number"
                  key={t.id}
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
              </div>
            )}
            <p
              ref={synopsis}
              id="title-synopsis"
              className={`title-description ${expanded ? "" : "is-clamped"}`}
            >
              {t.synopsis || "No description available yet."}
            </p>
            {(clamped || expanded) && (
              <button
                type="button"
                className="text-button synopsis-toggle"
                aria-expanded={expanded}
                aria-controls="title-synopsis"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Less" : "More"}
              </button>
            )}
          </div>
        </section>
        <section className="release-channels" aria-labelledby="release-dates">
          <div className="channels-heading">
            <h3 id="release-dates">Release dates</h3>
            <span title={countries[market]}>{market}</span>
          </div>
          <ul className="channel-list">
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
              { label: "Any streaming service" },
            )}
          </ul>
        </section>
        <details className="detail-more" ref={more}>
          <summary>More options</summary>
          <div className="more-panel">
            {extraServices.length > 0 && (
              <section className="more-section">
                <h4>Track another service</h4>
                <ul className="channel-list is-compact">
                  {extraServices.map((service) =>
                    channelRow("streaming", service, [], { extra: true }),
                  )}
                </ul>
              </section>
            )}
            <section className="more-section">
              <h4>Notify me when</h4>
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
                <div className="more-actions">
                  <small>Sent to your in-app inbox.</small>
                  <button disabled={!!busy}>Save</button>
                </div>
              </form>
            </section>
            <section className="more-section">
              <h4>Sources</h4>
              {events.length > 0 && (
                <ul className="source-list">
                  {events.map((e) => (
                    <li className="source-entry" key={e.id}>
                      <div>
                        <strong>
                          {e.service ||
                            (e.medium === "theatrical"
                              ? "In cinemas"
                              : "Streaming")}
                        </strong>
                        <small>
                          {e.source}
                          {e.sourceUrl && (
                            <>
                              {" · "}
                              <a
                                href={e.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Source
                                <ExternalLink
                                  size={11}
                                  strokeWidth={1.75}
                                  aria-hidden="true"
                                />
                              </a>
                            </>
                          )}
                        </small>
                      </div>
                      <button
                        type="button"
                        aria-label={`Edit ${e.service || (e.medium === "theatrical" ? "cinema" : "streaming")} date`}
                        onClick={() => setEditor(e)}
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="text-button add-date"
                onClick={() => setEditor(null)}
              >
                <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                Add or correct a date
              </button>
            </section>
            {!!t.episodes?.length && (
              <section className="more-section">
                <h4>
                  Episodes <span>{t.episodes.length}</span>
                </h4>
                <ol className="episode-list">
                  {t.episodes.map((e) => (
                    <li key={e.number}>
                      <span>
                        {e.number}. {e.name}
                      </span>
                      <small>{e.originalAirDate || "TBA"}</small>
                    </li>
                  ))}
                </ol>
                <small className="more-note">
                  Original air dates; local streaming dates may differ.
                </small>
              </section>
            )}
          </div>
        </details>
      </div>
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
