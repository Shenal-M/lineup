// Web Push (phone notifications) with VAPID. Subscriptions are `records` rows of kind
// 'push_subscriptions' (id = sha256 of the endpoint); a notification is pushed at most
// once, claimed by setting `pushed` on its body in the statement that selects it.
import { createHash } from "node:crypto";
import webpush from "web-push";
import { ValidationError } from "./model.ts";
import { lit, type Store } from "./postgres-store.ts";
import { LABELS, when, where } from "./email-template.ts";

export type PushPayload = { title: string; body: string; tag: string; url: string };
type Subscription = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
};
type Send = (s: Subscription, payload: PushPayload) => Promise<unknown>;

const DAY = 86400000;
// Notifications pushed per run; any others go out on the next run (within their 24h).
const BATCH = 20;
// Browser push services only: the server POSTs to the stored endpoint.
const PUSH_HOSTS =
  /^(fcm\.googleapis\.com|android\.googleapis\.com|[\w.-]+\.push\.services\.mozilla\.com|[\w.-]+\.push\.apple\.com|[\w.-]+\.notify\.windows\.com)$/;

const subject = () =>
  process.env.VAPID_SUBJECT ||
  (process.env.APP_URL?.startsWith("https://") ? process.env.APP_URL : "");
export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && subject());
}
export const pushPublicKey = () => (pushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null);
export const pushSubscriptionId = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex");

// The browser's PushSubscription JSON, from an explicit field allowlist.
export function pushSubscriptionFrom(input: any) {
  const invalid = new ValidationError("Invalid push subscription");
  const endpoint = input?.endpoint,
    keys = input?.keys;
  if (typeof endpoint !== "string" || endpoint.length > 2000) throw invalid;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw invalid;
  }
  if (url.protocol !== "https:" || !PUSH_HOSTS.test(url.hostname)) throw invalid;
  const key = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max && /^[\w-]+=*$/.test(v);
  if (!keys || !key(keys.p256dh, 200) || !key(keys.auth, 100)) throw invalid;
  return { endpoint, keys: { p256dh: keys.p256dh as string, auth: keys.auth as string } };
}

// "Coming tomorrow: The Gilded Age" / "Season 4 · HBO Max · Sun, Nov 1".
export function pushPayload(
  n: {
    id: string;
    kind: string;
    titleName?: string;
    date?: string | null;
    medium: string;
    service?: string | null;
  },
  release?: { season?: number; precision?: string } | null,
): PushPayload {
  const label = LABELS[n.kind]?.eyebrow || "Release reminder";
  return {
    title: `${label}: ${n.titleName || "Your followed title"}`,
    body: `${where(n, release?.season)} · ${when(n.date, release?.precision, true)}`,
    tag: n.id,
    url: "/following",
  };
}

// Which (notification, subscription) pairs to push: notifications from the last 24h,
// each only to devices subscribed before it was created, so turning push on never
// replays the inbox.
export function pushTargets<N extends { createdAt: string }, S extends { createdAt: string }>(
  notifications: N[],
  subscriptions: S[],
  now = Date.now(),
) {
  const out: { n: N; s: S }[] = [];
  for (const n of notifications) {
    const created = Date.parse(n.createdAt);
    if (!(now - created < DAY)) continue;
    for (const s of subscriptions)
      if (created >= Date.parse(s.createdAt)) out.push({ n, s });
  }
  return out;
}

const sendPush: Send = (s, payload) =>
  webpush.sendNotification(
    { endpoint: s.endpoint, keys: s.keys },
    JSON.stringify(payload),
    {
      vapidDetails: {
        subject: subject(),
        publicKey: process.env.VAPID_PUBLIC_KEY!,
        privateKey: process.env.VAPID_PRIVATE_KEY!,
      },
      // A phone that is off for a day just misses the reminder (the inbox still has it).
      TTL: DAY / 1000,
      urgency: "normal",
      timeout: 8000,
    },
  );

// Sends every job; subscriptions the push service reports gone (404/410) are deleted.
async function sendAll(
  store: Store,
  jobs: { s: Subscription; payload: PushPayload }[],
  send: Send,
) {
  const counts = { sent: 0, failed: 0, removed: 0 };
  const gone = new Set<string>();
  await Promise.all(
    jobs.map(async ({ s, payload }) => {
      try {
        await send(s, payload);
        counts.sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) gone.add(s.id);
        else {
          counts.failed++;
          console.error(
            "Push delivery failed:",
            e?.statusCode ? `HTTP ${e.statusCode}` : e instanceof Error ? e.message : String(e),
          );
        }
      }
    }),
  );
  if (gone.size) {
    await store.sql.unsafe(
      `delete from records where kind='push_subscriptions' and id in (${[...gone].map(lit).join(",")})`,
    );
    counts.removed = gone.size;
  }
  return counts;
}

// One statement claims up to BATCH unpushed, unread notifications from the last 24h
// (the pushed check is repeated on the updated row, so concurrent runs can't both claim
// one) and returns them with their releases and every push subscription.
export async function deliverPushes(store: Store, send: Send = sendPush, now = Date.now()) {
  const fresh =
    `kind='notifications' and (body::jsonb->>'pushed') is distinct from 'true' ` +
    `and (body::jsonb->>'read') is distinct from 'true'`;
  const rows: any[] = await store.sql.unsafe(
    `with c as (update records set body=(body::jsonb || '{"pushed":true}')::text where ${fresh} and id in (` +
      `select id from records where ${fresh} and body::jsonb->>'createdAt' >= ${lit(new Date(now - DAY).toISOString())} ` +
      `order by body::jsonb->>'createdAt', id limit ${BATCH}) returning body) ` +
      `select 'n' as kind, c.body, (select r.body from records r where r.kind='releases' and r.id=c.body::jsonb->>'eventId') as release from c ` +
      `union all select 'sub', body, null from records where kind='push_subscriptions'`,
  );
  const notifications: any[] = [],
    subs: Subscription[] = [],
    releases = new Map<string, any>();
  for (const r of rows) {
    const body = JSON.parse(r.body);
    if (r.kind === "sub") subs.push(body);
    else {
      notifications.push(body);
      if (r.release) releases.set(body.id, JSON.parse(r.release));
    }
  }
  const jobs = pushTargets(notifications, subs, now).map(({ n, s }) => ({
    s,
    payload: pushPayload(n, releases.get(n.id)),
  }));
  return { claimed: notifications.length, ...(await sendAll(store, jobs, send)) };
}

// For the cron job and worker: push never fails the run or delays email delivery.
export async function deliverPushesSafely(store: Store) {
  if (!pushConfigured()) return "not configured" as const;
  try {
    return await deliverPushes(store);
  } catch (e) {
    console.error("Push delivery failed:", e instanceof Error ? e.message : String(e));
    return { error: "Push delivery failed" };
  }
}

export async function sendTestPush(store: Store, send: Send = sendPush) {
  if (!pushConfigured()) throw new ValidationError("Phone notifications are not configured.");
  const subs: Subscription[] = (
    await store.sql.unsafe(`select body from records where kind='push_subscriptions'`)
  ).map((r: any) => JSON.parse(r.body));
  return sendAll(
    store,
    subs.map((s) => ({
      s,
      payload: {
        title: "Lineup",
        body: "Phone notifications are on. Reminders will show up like this.",
        tag: "lineup-test",
        url: "/settings",
      },
    })),
    send,
  );
}

// createdAt is kept when the same device subscribes again, so re-syncing a subscription
// doesn't make older notifications eligible.
export async function savePushSubscription(store: Store, input: unknown, userAgent = "") {
  const sub = pushSubscriptionFrom(input);
  const id = pushSubscriptionId(sub.endpoint);
  const body = {
    id,
    ...sub,
    userAgent: userAgent.slice(0, 300),
    createdAt: new Date().toISOString(),
  };
  await store.sql.unsafe(
    `insert into records(kind,id,body) values('push_subscriptions',${lit(id)},${lit(JSON.stringify(body))}) ` +
      `on conflict(kind,id) do update set body=jsonb_set(excluded.body::jsonb,'{createdAt}',` +
      `coalesce(records.body::jsonb->'createdAt',excluded.body::jsonb->'createdAt'))::text`,
  );
  return id;
}

export async function removePushSubscription(store: Store, endpoint: unknown) {
  if (typeof endpoint !== "string" || !endpoint || endpoint.length > 2000)
    throw new ValidationError("Invalid push subscription");
  await store.sql.unsafe(
    `delete from records where kind='push_subscriptions' and id=${lit(pushSubscriptionId(endpoint))}`,
  );
}
