import { createHash } from "node:crypto";
import { matches } from "./model.ts";
import type { openPostgresStore } from "./postgres-store.ts";

type Store = ReturnType<typeof openPostgresStore>;
export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
export async function sendReminder(
  notification: any,
  title: any,
  recipient: string,
  fetcher = fetch,
) {
  if (!emailConfigured())
    throw Error("Configure RESEND_API_KEY and EMAIL_FROM for email delivery.");
  const labels: Record<string, string> = {
    announced: "Release date announced",
    changed: "Release updated",
    week: "Coming in one week",
    day: "Coming tomorrow",
    release: "Releasing today",
  };
  const subject = `${title?.demo ? "[Sample] " : ""}${labels[notification.kind] || "Release reminder"}: ${title?.name || "Your followed title"}`;
  const result = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Idempotency-Key": createHash("sha256")
        .update("lineup:" + notification.id)
        .digest("hex"),
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [recipient],
      subject,
      text: [
        subject,
        `${notification.service || notification.medium} · ${notification.date || "Date to be announced"}`,
        title?.demo
          ? "Illustrative sample data; this is not verified release information."
          : "",
        "Manage your follows and reminder rules in Lineup.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!result.ok) throw Error(`Email provider returned HTTP ${result.status}`);
  const receipt = await result.json();
  if (!receipt.id) throw Error("Email provider did not return a delivery ID");
  return receipt.id as string;
}

export async function deliverEmails(store: Store, fetcher = fetch) {
  if (!emailConfigured()) throw Error("Email delivery is not configured.");
  const owner = await store.db
    .prepare("select email from account where id='owner'")
    .get();
  if (!owner) return { sent: 0, failed: 0, review: 0 };
  const counts = { sent: 0, failed: 0, review: 0 };
  const rows =
    await store.sql`select r.body from records r left join email_deliveries d on d.id=r.id where r.kind='notifications' and d.sent_at is null and (d.last_error is null or d.last_error not in ('manual_review','suppressed')) order by r.body::jsonb->>'createdAt' limit 5`;
  for (const row of rows) {
    const n = JSON.parse(row.body);
    // Commit first-attempt time before sending: a crash cannot reset the retry window.
    await store.sql`insert into email_deliveries(id,first_attempt) values(${n.id},${Date.now()}) on conflict(id) do nothing`;
    await store.transaction(async (tx) => {
      const [delivery] =
        await tx`select * from email_deliveries where id=${n.id} for update`;
      if (
        delivery.sent_at ||
        ["manual_review", "suppressed"].includes(delivery.last_error)
      )
        return;
      // Resend idempotency lasts 24h. Stop automatic retries before that window expires.
      if (Date.now() - Number(delivery.first_attempt) >= 23 * 3600000) {
        await tx`update email_deliveries set last_error='manual_review' where id=${n.id}`;
        counts.review++;
        return;
      }
      const release = await store.getWith(tx, "releases", n.eventId);
      const sub = await store.getWith(tx, "subscriptions", n.subscriptionId);
      const [eventJob] = await tx`select revision from outbox where id=${n.id}`;
      if (
        !release ||
        !eventJob ||
        release.revision !== eventJob.revision ||
        !sub ||
        !matches(sub, release) ||
        !sub.rules.includes(n.kind)
      ) {
        await tx`update email_deliveries set last_error='suppressed' where id=${n.id}`;
        return;
      }
      try {
        await sendReminder(
          n,
          await store.getWith(tx, "titles", n.titleId),
          owner.email,
          fetcher,
        );
        await tx`update email_deliveries set sent_at=${Date.now()},attempts=attempts+1,last_error=null where id=${n.id}`;
        counts.sent++;
      } catch (error) {
        await tx`update email_deliveries set attempts=attempts+1,last_error=${error instanceof Error ? error.message : "Send failed"} where id=${n.id}`;
        counts.failed++;
      }
    });
  }
  return counts;
}
