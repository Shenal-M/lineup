"use client";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Title, Release } from "./types";
import { dateLabel } from "./types";
import {
  Bell as BellIcon,
  BellRing,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Globe,
  Heart,
  LayoutGrid,
  List,
  Search,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      Lineup
    </span>
  );
}
const icons = {
  calendar: CalendarDays,
  search: Search,
  heart: Heart,
  settings: Settings,
  grid: LayoutGrid,
  list: List,
  prev: ChevronLeft,
  next: ChevronRight,
  close: X,
  globe: Globe,
} satisfies Record<string, LucideIcon>;
// Lucide icons; import others directly from "lucide-react" with the same props.
export function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof icons;
  size?: number;
}) {
  const Glyph = icons[name];
  return (
    <Glyph className="icon" size={size} strokeWidth={1.75} aria-hidden="true" />
  );
}
// Bell ↔ BellRing. The glyph type changes with `on`, so React remounts it; the
// `bell-swap` class (enter animation) is only added once the state has changed
// after mount, so lists don't animate every bell on first render.
export function Bell({
  on = false,
  className,
}: {
  on?: boolean;
  className?: string;
}) {
  const [prev, setPrev] = useState(on),
    [swapped, setSwapped] = useState(false);
  if (prev !== on) {
    setPrev(on);
    setSwapped(true);
  }
  const Glyph = on ? BellRing : BellIcon;
  return (
    <Glyph
      className={
        "icon" +
        (swapped ? " bell-swap" : "") +
        (className ? " " + className : "")
      }
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
    />
  );
}
// Sample titles render as a flat colour block with the title text only.
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
  const content = t.poster ? (
    <img src={t.poster} alt={`${t.name} poster`} loading="lazy" />
  ) : (
    <span className="poster-art">{t.art || t.name}</span>
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
export function channel(e: Release) {
  return (
    e.service || (e.medium === "theatrical" ? "In cinemas" : "Streaming")
  );
}
export function shortDate(date?: string | null) {
  if (!date) return "Date TBA";
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return date;
  return new Date(date.slice(0, 10) + "T12:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
/**
 * A title as a poster card (grid) or a compact row (lists).
 * The title button is stretched over the whole card so it is one tab stop;
 * the bell sits above it. `dated` adds the release date to the meta line
 * (off in the agenda, where the date column already shows it).
 * Memoised: props are values or stable references, so rows skip re-rendering
 * when unrelated app state changes.
 */
export const Card = memo(function Card({
  title: t,
  event: e,
  followed,
  onSelect,
  layout = "card",
  dated = true,
}: {
  title: Title;
  event?: Release;
  /** Followed in the current market. */
  followed: boolean;
  onSelect: (t: Title) => void;
  layout?: "card" | "row";
  dated?: boolean;
}) {
  const genre = t.genre?.split(" · ")[0];
  const meta = e
    ? dated
      ? [dateLabel(e), channel(e)]
      : [channel(e), genre]
    : [t.year, t.mediaType === "tv" ? "TV series" : "Movie", "Date TBA"];
  return (
    <article className={layout === "row" ? "title-row" : "card"}>
      <Poster title={t} />
      <div className="card-text">
        <button className="text-button card-name" onClick={() => onSelect(t)}>
          {t.name}
        </button>
        <div className="card-meta">
          {e && <span className={`dot ${e.medium}`} aria-hidden="true" />}
          <span>{meta.filter(Boolean).join(" · ")}</span>
        </div>
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
export function Heading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {children}
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
