import { createHash } from "node:crypto";
import { matches } from "./model.ts";
import { lit, type Store } from "./postgres-store.ts";
import { renderReminder } from "./email-template.ts";
export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
export async function sendReminder(
  notification: any,
  title: any,
  recipient: string,
  fetcher = fetch,
  release?: any,
) {
  if (!emailConfigured())
    throw Error("Configure RESEND_API_KEY and EMAIL_FROM for email delivery.");
  const { subject, html, text, attachments } = renderReminder({
    notification,
    title,
    release,
    appUrl: process.env.APP_URL || undefined,
  });
  const payload = JSON.stringify({
    from: process.env.EMAIL_FROM,
    to: [recipient],
    subject,
    html,
    text,
    attachments,
  });
  const result = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      // Retries reuse the key; it covers the content too, because the provider rejects a
      // reused key whose payload changed (e.g. the title was renamed between attempts).
      "Idempotency-Key": createHash("sha256")
        .update("lineup:" + notification.id + ":" + payload)
        .digest("hex"),
    },
    body: payload,
    signal: AbortSignal.timeout(8000),
  });
  if (!result.ok) throw Error(`Email provider returned HTTP ${result.status}`);
  const receipt = await result.json();
  if (!receipt.id) throw Error("Email provider did not return a delivery ID");
  return receipt.id as string;
}

// A claim older than this is considered abandoned (the send itself times out after 8s).
const CLAIM_MS = 2 * 60 * 1000;
// Resend idempotency lasts 24h. Stop automatic retries before that window expires.
const REVIEW_MS = 23 * 3600000;

// Delivery never holds the lock or a transaction across the HTTP call:
// 1. one short locked transaction picks up to five unsent notifications, records their
//    first attempt time (committed before any send, so a crash cannot reset the retry
//    window), validates them and claims the deliverable ones;
// 2. each claimed email is sent outside any transaction (same idempotency key on retry);
// 3. the outcome is recorded with one statement per email.
export async function deliverEmails(store: Store, fetcher = fetch) {
  if (!emailConfigured()) throw Error("Email delivery is not configured.");
  const counts = { sent: 0, failed: 0, review: 0 };
  const now = Date.now();
  const candidates = `select r.id, r.body from records r left join email_deliveries d on d.id=r.id where r.kind='notifications' and d.sent_at is null and (d.last_error is null or d.last_error not in ('manual_review','suppressed')) and (d.claimed_at is null or d.claimed_at<${now - CLAIM_MS}) and exists(select 1 from account where id='owner') order by r.body::jsonb->>'createdAt', r.id limit 5`;
  const claimed = await store.atomic(
    `insert into email_deliveries(id,first_attempt) select id, ${now} from (${candidates}) c on conflict(id) do nothing;
    select jsonb_build_object(
      'n', c.body::jsonb,
      'delivery', to_jsonb(d),
      'release', (select body::jsonb from records where kind='releases' and id=c.body::jsonb->>'eventId'),
      'sub', (select body::jsonb from records where kind='subscriptions' and id=c.body::jsonb->>'subscriptionId'),
      'title', (select body::jsonb from records where kind='titles' and id=c.body::jsonb->>'titleId'),
      'outboxRevision', (select revision from outbox where id=c.id),
      'owner', (select email from account where id='owner')
    )::text as body from (${candidates}) c join email_deliveries d on d.id=c.id`,
    (rows) => {
      const review: string[] = [],
        suppressed: string[] = [],
        send: any[] = [];
      for (const row of rows) {
        const { n, delivery, release, sub, title, outboxRevision, owner } =
          JSON.parse(row.body);
        if (
          delivery.sent_at ||
          ["manual_review", "suppressed"].includes(delivery.last_error) ||
          // Another job is sending this email right now.
          (delivery.claimed_at && now - Number(delivery.claimed_at) < CLAIM_MS)
        )
          continue;
        if (now - Number(delivery.first_attempt) >= REVIEW_MS) review.push(n.id);
        else if (
          !release ||
          outboxRevision == null ||
          release.revision !== outboxRevision ||
          !sub ||
          !matches(sub, release) ||
          !sub.rules.includes(n.kind)
        )
          suppressed.push(n.id);
        else send.push({ n, title, owner, release });
      }
      counts.review += review.length;
      const ids = (xs: string[]) => xs.map(lit).join(",");
      return {
        statements: [
          review.length
            ? `update email_deliveries set last_error='manual_review' where id in (${ids(review)})`
            : "",
          suppressed.length
            ? `update email_deliveries set last_error='suppressed' where id in (${ids(suppressed)})`
            : "",
          send.length
            ? `update email_deliveries set claimed_at=${now} where id in (${ids(send.map((x) => x.n.id))})`
            : "",
        ],
        result: send,
      };
    },
  );
  for (const { n, title, owner, release } of claimed) {
    try {
      await sendReminder(n, title, owner, fetcher, release);
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Send failed").slice(0, 500);
      await store.sql.unsafe(
        `update email_deliveries set attempts=attempts+1,last_error=${lit(message)},claimed_at=null where id=${lit(n.id)}`,
      );
      counts.failed++;
      continue;
    }
    // If this write fails, the claim expires and a later run retries with the same
    // idempotency key, which the provider deduplicates.
    await store.sql.unsafe(
      `update email_deliveries set sent_at=${Date.now()},attempts=attempts+1,last_error=null,claimed_at=null where id=${lit(n.id)}`,
    );
    counts.sent++;
  }
  return counts;
}
