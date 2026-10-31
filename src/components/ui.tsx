"use client";
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type SVGProps,
} from "react";
import type { Title, Release, Episode } from "./types";
import { dateLabel } from "./types";
import { dayInZone } from "../model";
import {
  Bell as BellIcon,
  BellRing,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Film,
  Globe,
  Heart,
  LayoutGrid,
  List,
  MonitorDown,
  MonitorPlay,
  Search,
  Settings,
  Tv,
  X,
  type LucideIcon,
} from "lucide-react";
// Three lobes growing toward the viewer: a line-up of what's coming. Ids are
// per instance so each inline copy keeps its own gradients.
const lobes = [
  { cx: 23, cy: 47, rx: 13.5, ry: 19, rotate: 0 },
  { cx: 39, cy: 48.5, rx: 15.5, ry: 27, rotate: 4 },
  { cx: 63, cy: 51, rx: 22, ry: 39, rotate: 8 },
];
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  const id = useId().replace(/[^\w-]/g, ""),
    ref = (name: string) => `url(#${id}-${name})`;
  const lobe = (i: number, props: SVGProps<SVGEllipseElement> = {}) => {
    const { cx, cy, rx, ry, rotate } = lobes[i];
    return (
      <ellipse
        key={i}
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        transform={`rotate(${rotate} ${cx} ${cy})`}
        {...props}
      />
    );
  };
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}-body`}
          gradientUnits="userSpaceOnUse"
          x1="10"
          y1="28"
          x2="86"
          y2="66"
        >
          <stop offset="0" stopColor="#e2fb93" />
          <stop offset="0.4" stopColor="#bef264" />
          <stop offset="0.85" stopColor="#7cc520" />
          <stop offset="1" stopColor="#5fa818" />
        </linearGradient>
        <radialGradient
          id={`${id}-sheen`}
          gradientUnits="userSpaceOnUse"
          cx="34"
          cy="30"
          r="40"
        >
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="#143300" stopOpacity="0" />
          <stop offset="1" stopColor="#143300" stopOpacity="0.32" />
        </linearGradient>
        <radialGradient id={`${id}-rim`} cx="0.36" cy="0.48" r="0.64">
          <stop offset="0.8" stopColor="#e7fff2" stopOpacity="0" />
          <stop offset="1" stopColor="#e7fff2" stopOpacity="0.8" />
        </radialGradient>
        <filter id={`${id}-lift`} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow
            dx="-1.2"
            dy="0.4"
            stdDeviation="2.2"
            floodColor="#1d4a00"
            floodOpacity="0.32"
          />
        </filter>
        <clipPath id={`${id}-all`}>{[0, 1, 2].map((i) => lobe(i))}</clipPath>
      </defs>
      <g clipPath={ref("all")}>
        <rect width="100" height="100" fill={ref("body")} />
        {[1, 2].map((i) => lobe(i, { fill: ref("body"), filter: ref("lift") }))}
        <rect width="100" height="100" fill={ref("sheen")} />
        <rect width="100" height="100" fill={ref("shade")} />
        {lobe(2, { fill: ref("rim") })}
      </g>
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <BrandMark />
      Lineup
    </span>
  );
}
const icons = {
  film: Film,
  tv: Tv,
  search: Search,
  heart: Heart,
  settings: Settings,
  grid: LayoutGrid,
  list: List,
  prev: ChevronLeft,
  next: ChevronRight,
  close: X,
  globe: Globe,
  // Release channels: cinema, subscription streaming, digital (rent/buy VOD).
  theatrical: Clapperboard,
  streaming: MonitorPlay,
  digital: MonitorDown,
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
  const content = t.poster ? (
    <img src={t.poster} alt={`${t.name} poster`} loading="lazy" />
  ) : (
    <span className="poster-art">{t.name}</span>
  );
  return onClick ? (
    <button className="poster" onClick={onClick} aria-label={`View ${t.name}`}>
      {content}
    </button>
  ) : (
    <div className="poster">{content}</div>
  );
}
export function channel(e: Release) {
  const where =
    e.medium === "theatrical"
      ? "In cinemas"
      : e.medium === "digital"
        ? e.service
          ? `Digital · ${e.service}`
          : "Digital"
        : e.service || "Streaming";
  return e.season ? `Season ${e.season} · ${where}` : where;
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
 * The next episode of a season that has already premiered (before `today`) and is
 * still airing: the title's next episode is in that season and dated today or later.
 * Undefined for a premiere still to come, or a season finished or on a break.
 */
export function airingEpisode(
  t: Title,
  e: Release | undefined,
  today: string,
): (Episode & { date: string }) | undefined {
  const n = t.nextEpisode;
  if (
    !e?.season ||
    e.precision !== "day" ||
    !e.date ||
    e.date >= today ||
    n?.season !== e.season ||
    !n.date ||
    n.date < today
  )
    return undefined;
  return n as Episode & { date: string };
}
/** Today in the browser's own time zone, for components without the user's settings. */
const localToday = () =>
  dayInZone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
/**
 * A title as a poster card (grid) or a compact row (lists).
 * The title button is stretched over the whole card so it is one tab stop;
 * the bell sits above it. `dated` adds the release date to the meta line
 * (off in the agenda, where the date column already shows it). A TV season
 * that has premiered and is still airing also shows its next episode.
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
  today,
}: {
  title: Title;
  event?: Release;
  /** Followed in the current market. */
  followed: boolean;
  onSelect: (t: Title) => void;
  layout?: "card" | "row";
  dated?: boolean;
  /** Today (YYYY-MM-DD) in the user's zone; defaults to the browser's. */
  today?: string;
}) {
  const genre = t.genre?.split(" · ")[0],
    airing = e?.season ? airingEpisode(t, e, today || localToday()) : undefined,
    next = airing && `Next: E${airing.episode} · ${shortDate(airing.date)}`;
  const meta = e
    ? dated
      ? [dateLabel(e), channel(e), next]
      : [channel(e), next || genre]
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
// iOS sheet curve, for the snap back and the dismiss after a drag.
const SHEET_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
/**
 * Mobile bottom sheets follow a downward drag that starts on content scrolled
 * to the top (or anywhere that doesn't scroll), and close on a quick flick or
 * a pull past a quarter of their height; otherwise they spring back. Touch
 * events rather than pointer events, so the drag can stop the page from
 * bouncing (touchmove is cancelable). Desktop dialogs are left alone.
 */
function useSheetDrag(
  ref: RefObject<HTMLDialogElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const dialog: HTMLDialogElement = node;
    const sheet = window.matchMedia("(max-width: 760px)"),
      calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let from: { x: number; y: number; scroller: Element | null } | null = null,
      dragging = false,
      dy = 0,
      // Recent positions, for the release velocity.
      samples: { y: number; t: number }[] = [];
    const scrollerOf = (el: Element | null) => {
      for (; el && el !== dialog.parentElement; el = el.parentElement)
        if (
          el.scrollHeight > el.clientHeight + 1 &&
          /auto|scroll/.test(getComputedStyle(el).overflowY)
        )
          return el;
      return null;
    };
    const settle = (y: number, ms: number, done?: () => void) => {
      const finish = () => {
        dialog.style.transition = "";
        dialog.style.transform = "";
        done?.();
      };
      if (calm.matches) return finish();
      dialog.style.transition = `transform ${ms}ms ${SHEET_EASE}`;
      dialog.style.transform = `translateY(${y}px)`;
      // Closing unmounts the sheet, so finish on a timer, not transitionend.
      setTimeout(done ? () => done() : finish, ms);
    };
    function start(e: TouchEvent) {
      const target = e.target as Element;
      if (!sheet.matches || e.touches.length !== 1 || target.closest("input, textarea, select"))
        return;
      const t = e.touches[0];
      from = { x: t.clientX, y: t.clientY, scroller: scrollerOf(target) };
      dragging = false;
      dy = 0;
      samples = [];
    }
    function move(e: TouchEvent) {
      if (!from) return;
      const t = e.touches[0],
        dx = t.clientX - from.x;
      dy = t.clientY - from.y;
      if (!dragging) {
        // Scrolling content, upward or sideways moves: not a sheet drag.
        if ((from.scroller?.scrollTop ?? 0) > 0 || dy < 0 || Math.abs(dx) > Math.abs(dy)) {
          if (Math.hypot(dx, dy) > 6) from = null;
          return;
        }
        if (e.cancelable) e.preventDefault();
        if (dy < 6) return;
        dragging = true;
        from.y = t.clientY;
        dy = 0;
        dialog.style.transition = "none";
      }
      if (e.cancelable) e.preventDefault();
      const now = e.timeStamp;
      samples = [...samples.filter((s) => now - s.t < 100), { y: t.clientY, t: now }];
      // Past the top edge the sheet resists instead of stopping dead.
      const y = dy >= 0 ? dy : -Math.min(16, Math.sqrt(-dy) * 2);
      dialog.style.transform = `translateY(${y}px)`;
    }
    function end() {
      if (!from) return;
      from = null;
      if (!dragging) return;
      dragging = false;
      const first = samples[0],
        last = samples[samples.length - 1],
        velocity =
          first && last && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      const height = dialog.offsetHeight;
      if (dy > height * 0.25 || velocity > 0.4)
        settle(height, 200, () => close.current());
      else settle(0, 320);
    }
    dialog.addEventListener("touchstart", start, { passive: true });
    dialog.addEventListener("touchmove", move, { passive: false });
    dialog.addEventListener("touchend", end);
    dialog.addEventListener("touchcancel", end);
    return () => {
      dialog.removeEventListener("touchstart", start);
      dialog.removeEventListener("touchmove", move);
      dialog.removeEventListener("touchend", end);
      dialog.removeEventListener("touchcancel", end);
    };
  }, [ref]);
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
  useSheetDrag(ref, onClose);
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
