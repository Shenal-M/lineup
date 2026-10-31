// Reminder email: table layout with inline styles (what mail clients reliably render),
// dark to match the app, plus a plain-text part. No SVG or web fonts: Gmail drops both,
// so the logo goes as an inline PNG attachment referenced by its content id.
import { EMAIL_LOGO_PNG } from "./email-logo.ts";

const LOGO_CID = "lineup-logo";
const C = {
  bg: "#0a0a0b",
  card: "#111113",
  line: "#222226",
  text: "#ededef",
  text2: "#a1a1aa",
  text3: "#71717a",
  accent: "#bef264",
  accentSoft: "#1f2a10",
};
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Also used for push notification titles (src/push.ts).
export const LABELS: Record<string, { eyebrow: string; lead: string }> = {
  announced: { eyebrow: "Date announced", lead: "has a release date" },
  changed: { eyebrow: "Release updated", lead: "has a new release date" },
  week: { eyebrow: "Coming in one week", lead: "is out in one week" },
  day: { eyebrow: "Coming tomorrow", lead: "is out tomorrow" },
  release: { eyebrow: "Out today", lead: "is out today" },
};

export type ReminderInput = {
  notification: {
    kind: string;
    date?: string | null;
    medium: string;
    service?: string | null;
    titleName?: string;
  };
  title?: {
    name?: string;
    mediaType?: string;
    year?: number | null;
    genre?: string;
    poster?: string | null;
  } | null;
  /** The release, when known: adds the season and the date's precision. */
  release?: { season?: number; precision?: string } | null;
  /** Public app URL for the "Open Lineup" button; the button is left out without it. */
  appUrl?: string;
  /** Logo image source; defaults to the inline attachment (override for previews). */
  logoSrc?: string;
};

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// short: "Sun, Nov 1" / "Dec 2026" for push notifications instead of the full form.
export function when(date: string | null | undefined, precision = "day", short = false) {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date) || precision === "unknown")
    return "Date to be announced";
  const d = new Date(date.slice(0, 10) + "T12:00Z"),
    fmt = (o: Intl.DateTimeFormatOptions) =>
      d.toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  if (precision === "year") return date.slice(0, 4);
  if (precision === "quarter")
    return `Q${Math.ceil((d.getUTCMonth() + 1) / 3)} ${date.slice(0, 4)}`;
  if (precision === "month") return fmt({ month: short ? "short" : "long", year: "numeric" });
  return short
    ? fmt({
        weekday: "short",
        month: "short",
        day: "numeric",
        // The year only when it isn't this one.
        ...(d.getUTCFullYear() !== new Date().getUTCFullYear() ? { year: "numeric" } : {}),
      })
    : fmt({ weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function where(n: ReminderInput["notification"], season?: number) {
  const place =
    n.medium === "theatrical"
      ? "In cinemas"
      : n.medium === "digital"
        ? n.service
          ? `Digital · ${n.service}`
          : "Digital (rent or buy)"
        : n.service || "Streaming";
  return season ? `Season ${season} · ${place}` : place;
}

export function renderReminder({
  notification: n,
  title,
  release,
  appUrl,
  logoSrc = "cid:" + LOGO_CID,
}: ReminderInput) {
  const name = title?.name || n.titleName || "Your followed title";
  const label = LABELS[n.kind] || { eyebrow: "Release reminder", lead: "has an update" };
  const date = when(n.date, release?.precision),
    channel = where(n, release?.season);
  const meta = [
    title?.mediaType === "tv" ? "TV series" : title?.mediaType === "movie" ? "Movie" : "",
    title?.year ? String(title.year) : "",
    (title?.genre || "").split(" · ").filter(Boolean).slice(0, 2).join(", "),
  ].filter(Boolean);
  const subject = `${label.eyebrow}: ${name}`;
  const summary = `${name} ${label.lead} · ${channel} · ${date}`;
  const text = [
    subject,
    `${channel}\n${date}`,
    appUrl ? `Open Lineup: ${appUrl}` : "",
    "You're getting this because you follow this title in Lineup. Reminders mean a release is scheduled, not verified available.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const poster = title?.poster
    ? `<td width="96" valign="top" style="padding:0 20px 0 0"><img src="${escape(title.poster.replace("/w500/", "/w342/"))}" width="96" height="144" alt="" style="display:block;width:96px;height:144px;border-radius:10px;object-fit:cover;border:1px solid ${C.line}"></td>`
    : "";
  const button = appUrl
    ? `<tr><td style="padding:28px 0 0"><a href="${escape(appUrl)}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:${C.text};color:${C.bg};font:600 14px ${FONT};text-decoration:none">Open Lineup</a></td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(summary)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}">
<tr><td align="center" style="padding:40px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
    <tr><td style="padding:0 4px 20px;font:600 16px ${FONT};color:${C.text};letter-spacing:-0.2px">
      <img src="${escape(logoSrc)}" width="26" height="26" alt="" style="display:inline-block;width:26px;height:26px;border:0;vertical-align:middle"><span style="vertical-align:middle;margin-left:6px">Lineup</span>
    </td></tr>
    <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:16px;padding:28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:0 0 20px">
          <span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${C.accentSoft};color:${C.accent};font:600 12px ${FONT};letter-spacing:0.2px">${escape(label.eyebrow)}</span>
        </td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${poster}
            <td valign="top">
              <div style="font:700 22px/1.25 ${FONT};color:${C.text};letter-spacing:-0.3px">${escape(name)}</div>
              ${meta.length ? `<div style="padding-top:6px;font:400 13px/1.4 ${FONT};color:${C.text3}">${escape(meta.join(" · "))}</div>` : ""}
              <div style="padding-top:20px;font:600 17px/1.35 ${FONT};color:${C.text}">${escape(date)}</div>
              <div style="padding-top:4px;font:400 14px/1.4 ${FONT};color:${C.text2}">${escape(channel)}</div>
            </td>
          </tr></table>
        </td></tr>
        ${button}
      </table>
    </td></tr>
    <tr><td style="padding:20px 4px 0;font:400 12px/1.6 ${FONT};color:${C.text3}">
      You’re getting this because you follow ${escape(name)} in Lineup. Reminders mean a release is scheduled, not verified available. Change what you’re notified about from the title’s “More options”.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  // Resend attachment shape; content_id makes it an inline image.
  const attachments = [
    { filename: "lineup.png", content: EMAIL_LOGO_PNG, content_id: LOGO_CID },
  ];
  return { subject, html, text, attachments };
}
