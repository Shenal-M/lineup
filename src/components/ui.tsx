"use client";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { Title, Release, State } from "./types";
import { dateLabel } from "./types";
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">L</span> lineup
      <span className="brand-dot">.</span>
    </span>
  );
}
export function Bell() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </svg>
  );
}
export function Poster({
  title: t,
  onClick,
}: {
  title: Title;
  onClick?: () => void;
}) {
  const style = t.demo
    ? ({ "--ink": t.ink, "--poster-bg": t.bg } as CSSProperties)
    : undefined;
  const content = (
    <>
      {t.poster ? (
        <img src={t.poster} alt={`${t.name} poster`} loading="lazy" />
      ) : (
        <>
          <span className="poster-art">{t.art || t.name}</span>
          <span className="poster-credit">{t.credit}</span>
        </>
      )}
      <span className="poster-tag">
        {t.mediaType === "tv" ? "TV SERIES" : "MOVIE"}
        {t.demo ? " · SAMPLE" : ""}
      </span>
    </>
  );
  return onClick ? (
    <button
      className="poster"
      onClick={onClick}
      aria-label={`View ${t.name}`}
      style={style}
    >
      {content}
    </button>
  ) : (
    <div className="poster" style={style}>
      {content}
    </div>
  );
}
export function Card({
  title: t,
  event: e,
  state,
  onSelect,
}: {
  title: Title;
  event?: Release;
  state: State;
  onSelect: (t: Title) => void;
}) {
  const followed = state.subscriptions.some(
    (s) => s.titleId === t.id && s.market === state.settings.market,
  );
  return (
    <article className="card">
      <Poster title={t} onClick={() => onSelect(t)} />
      <div className="card-info">
        <div>
          <button className="text-button card-name" onClick={() => onSelect(t)}>
            {t.name}
          </button>
          <div className="card-meta">
            {t.year || "TBA"} · {t.genre || t.mediaType}
          </div>
        </div>
        <button
          className={`follow-btn ${followed ? "on" : ""}`}
          onClick={() => onSelect(t)}
          aria-label={`Follow options for ${t.name}`}
        >
          {followed ? "♥" : "+"}
        </button>
      </div>
      <div className="event-info">
        <span className="dot" />
        {e ? (
          <>
            {dateLabel(e)} ·{" "}
            {e.service ||
              (e.medium === "theatrical"
                ? "In cinemas"
                : "Streaming · service TBA")}
          </>
        ) : (
          "Release date not yet sourced"
        )}
      </div>
    </article>
  );
}
export function Heading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  children,
  onClose,
  className = "",
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      {children}
    </dialog>
  );
}
