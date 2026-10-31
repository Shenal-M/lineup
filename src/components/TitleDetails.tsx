"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, Play, Plus, X } from "lucide-react";
import { Bell, Icon, Modal, Poster, airingEpisode, channel, shortDate } from "./ui";
import {
  api,
  countries,
  dateLabel,
  defaultRules,
  rules,
  serviceLogos,
  services,
  type State,
  type Title,
  type Release,
  type Season,
} from "./types";
import { dayInZone, type Medium } from "../model";
type Trailer = { key: string; name: string };
type Props = {
  title: Title;
  /** Live TMDB dates for every market; undefined while loading. */
  releases?: Release[] | null;
  state: State;
  refresh: () => Promise<State>;
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
const channelKey = (medium: Medium, service: string | null, all = false) =>
  `${medium}:${all ? "*" : service}`;
export function TitleDetails({
  title: t,
  releases,
  state,
  refresh,
  onClose,
  notify,
  onError,
}: Props) {
  const [editor, setEditor] = useState<Release | null | undefined>(undefined),
    [busy, setBusy] = useState(""),
    // Optimistic bell state per channel while its request is in flight.
    [pending, setPending] = useState<Record<string, boolean>>({}),
    [expanded, setExpanded] = useState(false),
    [clamped, setClamped] = useState(false),
    [season, setSeason] = useState<Season | null>(null),
    // The title's YouTube trailer: undefined while unknown, null when there is none.
    [trailer, setTrailer] = useState<Trailer | null | undefined>(undefined),
    [playing, setPlaying] = useState(false);
  const more = useRef<HTMLDetailsElement>(null),
    synopsis = useRef<HTMLParagraphElement>(null),
    trailerButton = useRef<HTMLButtonElement>(null),
    trailerClose = useRef<HTMLButtonElement>(null);
  // A followed title shows its stored dates (corrections, what reminders use);
  // any other title shows TMDB's live dates.
  const market = state.settings.market,
    stored = state.titles.some((x) => x.id === t.id),
    loading = !stored && releases === undefined,
    events = (stored ? state.releases : releases || []).filter(
      (e) => e.titleId === t.id && e.market === market,
    );
  const subscriptions = state.subscriptions.filter(
    (s) => s.titleId === t.id && s.market === market,
  );
  const [selectedRules, setSelectedRules] = useState<string[]>(
    subscriptions[0]?.rules || defaultRules,
  );
  useEffect(() => setExpanded(false), [t.id]);
  // Look the trailer up once the dialog opens; nothing plays until asked. A failed
  // lookup just hides the button.
  useEffect(() => {
    let live = true;
    setTrailer(undefined);
    setPlaying(false);
    api<Trailer | null>(`titles/${encodeURIComponent(t.id)}/trailer`)
      .then((v) => live && setTrailer(v?.key ? v : null))
      .catch(() => live && setTrailer(null));
    return () => {
      live = false;
    };
  }, [t.id]);
  // Focus follows the player: its close button when it opens, the Trailer
  // button when it closes.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (playing) {
      trailerClose.current?.focus({ preventScroll: true });
      trailerClose.current
        ?.closest(".trailer")
        ?.scrollIntoView({ block: "nearest" });
    } else if (wasPlaying.current) trailerButton.current?.focus();
    wasPlaying.current = playing;
  }, [playing]);
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
  // A channel is one named service, any service (null), or — for the merged
  // "Streaming" row of a single-service show — every subscription of the medium.
  function selected(medium: Medium, service: string | null, all = false) {
    return subscriptions.filter(
      (s) =>
        s.medium === medium &&
        (all ||
          (service ? s.services.includes(service) : !s.services.length)),
    );
  }
  async function toggle(
    medium: Medium,
    service: string | null,
    { extra = false, all = false } = {},
  ) {
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
    const existing = selected(medium, service, all),
      key = channelKey(medium, service, all);
    setBusy(key);
    // Flip the bell now; the server round-trip confirms (or reverts) it.
    setPending((p) => ({ ...p, [key]: !existing.length }));
    let keepPending = false;
    try {
      try {
        if (existing.length)
          await Promise.all(
            existing.map((s) => {
              // Unfollowing every service drops the whole record.
              const rest =
                service && !all ? s.services.filter((x) => x !== service) : [];
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
  async function pickSeason(number: string) {
    if (!number) return setSeason(null);
    setBusy("season");
    try {
      setSeason(
        await api<Season>(
          `titles/${encodeURIComponent(t.id)}/seasons/${number}`,
        ),
      );
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
    {
      label = service || "In cinemas",
      extra = false,
      all = false,
      via = null as string | null,
    } = {},
  ) {
    const key = channelKey(medium, service, all),
      on = pending[key] ?? selected(medium, service, all).length > 0,
      logo = service ? serviceLogos[service] : undefined,
      viaLogo = via ? serviceLogos[via] : undefined;
    return (
      <li className="channel-row" key={key}>
        {/* Extra-service rows are all streaming: the logo leads instead. */}
        {!extra && (
          <span className="channel-icon">
            <Icon name={medium} />
          </span>
        )}
        <span className="channel-name">
          {logo ? (
            <img className="service-logo" src={logo} alt={service!} />
          ) : (
            label
          )}
          {via &&
            (viaLogo ? (
              <img className="service-logo is-small" src={viaLogo} alt={via} />
            ) : (
              <span className="channel-via">{via}</span>
            ))}
        </span>
        {!extra && (
          <span className="channel-dates">
            {loading ? (
              <span className="date-tba">…</span>
            ) : dates.length ? (
              dates.map((e) => {
                // A season's date is its premiere; one still airing adds its
                // next episode underneath.
                const next = airingEpisode(t, e, today),
                  premiere =
                    e.season && e.date && e.precision === "day"
                      ? e.date < today
                        ? "Premiered "
                        : "Premieres "
                      : "";
                return (
                  <span key={e.id} className="channel-date-group">
                    <span className="channel-date">
                      {e.season && (
                        <small className="date-status">S{e.season}</small>
                      )}
                      {e.date && flaggedStatuses.includes(e.status) && (
                        <small className="date-status">
                          {e.status.replace("_", " ")}
                        </small>
                      )}
                      {e.date ? (
                        premiere + dateLabel(e)
                      ) : (
                        <span className="date-tba">TBA</span>
                      )}
                    </span>
                    {next && (
                      <span className="channel-next">
                        Next episode: E{next.episode} · {shortDate(next.date)}
                      </span>
                    )}
                  </span>
                );
              })
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
          onClick={() => void toggle(medium, service, { extra, all })}
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
  // Movies are tracked by their cinema and digital (VOD) dates; service rows are for
  // TV, or for streaming dates added by hand.
  const movie = t.mediaType === "movie",
    showStreaming =
      !movie ||
      events.some((e) => e.medium === "streaming") ||
      subscriptions.some((s) => s.medium === "streaming");
  const extraServices = movie
    ? []
    : services.filter((s) => !shownServices.includes(s));
  const digital = events.filter((e) => e.medium === "digital"),
    digitalVia = digital.find((e) => e.service)?.service;
  // "Any service" follows fire for every service, so its date is the earliest one.
  const streaming = events.filter((e) => e.medium === "streaming"),
    unnamed = streaming.filter((e) => !e.service),
    anyService = unnamed.length
      ? unnamed
      : streaming
          .filter((e) => e.date)
          .sort((a, b) => a.date!.localeCompare(b.date!))
          .slice(0, 1);
  // One service (or none known): a single "Streaming" row covers named and
  // any-service follows alike, with that service's own dates.
  const singleService = shownServices.length <= 1,
    ownDates = shownServices.length
      ? streaming.filter((e) => e.service === shownServices[0])
      : [],
    streamingDates = ownDates.length ? ownDates : anyService;
  const today = dayInZone(new Date(), state.settings.timezone);
  const network = t.network,
    networkLogo = network ? network.logo || serviceLogos[network.name] : null;
  const meta = [
    t.mediaType === "tv" ? "TV" : "Movie",
    t.year,
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
        {playing && trailer && (
          <section className="trailer" aria-label={`${t.name} trailer`}>
            <div className="trailer-head">
              <span className="trailer-name">{trailer.name}</span>
              <button
                type="button"
                ref={trailerClose}
                className="trailer-close"
                aria-label="Close trailer"
                onClick={() => setPlaying(false)}
              >
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
                Close
              </button>
            </div>
            <div className="trailer-frame">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&rel=0&playsinline=1`}
                title={trailer.name}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </section>
        )}
        <section className="title-overview">
          <div className="detail-poster">
            <Poster title={t} />
          </div>
          <div className="title-copy">
            <div className="title-head">
              <h2>{t.name}</h2>
            </div>
            {network && (
              <p className="title-network" title={`On ${network.name}`}>
                {networkLogo ? (
                  <img
                    className="service-logo"
                    src={networkLogo}
                    alt={`On ${network.name}`}
                  />
                ) : (
                  <>
                    <span className="sr-only">On </span>
                    {network.name}
                  </>
                )}
              </p>
            )}
            {meta.length > 0 && (
              <p className="title-meta">{meta.join(" · ")}</p>
            )}
            {(!!t.seasons?.length || t.imdbId || trailer) && (
              <div className="title-actions">
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
                      onChange={(e) => {
                        void pickSeason(e.target.value);
                        if (more.current) more.current.open = true;
                      }}
                    >
                      <option value="">Episodes by season</option>
                      {t.seasons.map((s) => (
                        <option key={s.number} value={s.number}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {t.imdbId && (
                  <a
                    className="imdb-link"
                    href={`https://www.imdb.com/title/${encodeURIComponent(t.imdbId)}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t.name} on IMDb (opens in a new tab)`}
                  >
                    IMDb
                    <ExternalLink
                      size={12}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </a>
                )}
                {trailer && (
                  <button
                    type="button"
                    ref={trailerButton}
                    className="imdb-link trailer-link"
                    aria-pressed={playing}
                    onClick={() => setPlaying((v) => !v)}
                  >
                    <Play size={12} strokeWidth={1.75} aria-hidden="true" />
                    Trailer
                  </button>
                )}
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
            {(movie || digital.length > 0) &&
              channelRow("digital", null, digital, {
                label: "Digital",
                via: digitalVia || null,
              })}
            {showStreaming &&
              singleService &&
              channelRow("streaming", null, streamingDates, {
                label: "Streaming",
                all: true,
              })}
            {showStreaming &&
              !singleService &&
              shownServices.map((service) =>
                channelRow(
                  "streaming",
                  service,
                  events.filter(
                    (e) => e.medium === "streaming" && e.service === service,
                  ),
                ),
              )}
            {showStreaming &&
              !singleService &&
              channelRow("streaming", null, anyService, {
                label: "Any streaming service",
              })}
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
                          {channel(e)}
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
                      {stored && (
                        <button
                          type="button"
                          aria-label={`Edit ${channel(e)} date`}
                          onClick={() => setEditor(e)}
                        >
                          Edit
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {stored ? (
                <button
                  type="button"
                  className="text-button add-date"
                  onClick={() => setEditor(null)}
                >
                  <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                  Add or correct a date
                </button>
              ) : (
                <small className="more-note">
                  {events.length ? "From TMDB. " : "TMDB has no dates for " + countries[market] + " yet. "}
                  Follow the title to correct its dates.
                </small>
              )}
            </section>
            {!!season?.episodes.length && (
              <section className="more-section">
                <h4>
                  {season.name} <span>{season.episodes.length}</span>
                </h4>
                <ol className="episode-list">
                  {season.episodes.map((e) => (
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
  const [medium, setMedium] = useState<Medium>(
      event?.medium || (title.mediaType === "movie" ? "digital" : "streaming"),
    ),
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
          service: medium === "theatrical" ? null : data.get("service") || null,
          offer:
            medium === "streaming"
              ? "subscription"
              : medium === "digital"
                ? "digital"
                : "ticket",
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
        Keep the date’s precision and source. TMDB updates won’t overwrite
        your correction.
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
              <option value="digital">Digital (VOD)</option>
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
