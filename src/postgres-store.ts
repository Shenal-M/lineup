import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { rootCertificates } from "node:tls";
import {
  matches,
  material,
  due,
  ValidationError,
  type Release,
  type Subscription,
} from "./model.ts";
import { SUPABASE_ROOT_CA } from "./supabase-ca.ts";
type Entry = { title: any; releases: Release[] };

// Round trips dominate latency (the database can be ~270ms away). With prepare:false
// (required by the transaction pooler) postgres.js sends every *parameterised* query as
// Parse/Describe, waits for the parameter types, then Bind/Execute: two round trips, and
// such queries cannot be pipelined. The store therefore inlines escaped literals and uses
// the simple query protocol: one round trip per message, and several statements can
// travel in one message (run in one implicit transaction when there is no BEGIN).
export function lit(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError("Non-finite number in SQL");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v !== "string") throw new TypeError("Unsupported SQL value");
  if (v.includes("\0")) throw new ValidationError("Text must not contain NUL characters");
  // Same escaping as libpq's PQescapeLiteral: an E'' string with backslashes and quotes
  // doubled, independent of standard_conforming_strings. The connection is UTF-8.
  return "E'" + v.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
}
const list = (values: unknown[]) => values.map(lit).join(",");
const json = (v: unknown) => lit(JSON.stringify(v));
const parse = (rows: any[]) => rows.map((r) => JSON.parse(r.body));
// Last result set of a (possibly multi-statement) simple query.
const lastResult = (r: any): any[] =>
  r.length && Array.isArray(r[0]) ? r[r.length - 1] : r;

type Plan = {
  releases: any[];
  observations: any[];
  supersede: Set<string>;
  outbox: any[];
};
// Fields whose change is worth recording as a new observation of a release.
const observed = (e: any) =>
  JSON.stringify([material(e), e.source || "", e.sourceUrl || ""]);
const stable = (v: any) =>
  JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]]));
// Dedupes by id (last wins): one INSERT ... ON CONFLICT cannot touch a row twice.
const uniqueById = (values: any[]) => [
  ...new Map(values.map((v) => [String(v.id), v])).values(),
];
const outboxRow = (s: Subscription, e: Release, kind: string, now: Date) => {
  const id = `${s.id}:${e.id}:${e.revision}:${kind}`;
  return {
    id,
    eventId: e.id,
    revision: e.revision,
    body: {
      id,
      subscriptionId: s.id,
      eventId: e.id,
      titleId: e.titleId,
      kind,
      date: e.date,
      medium: e.medium,
      service: e.service,
      createdAt: now.toISOString(),
    },
  };
};

// Statement builders. All return "" when there is nothing to write.
export function upsertRecords(
  kind: string,
  values: any[],
  { merge = false } = {},
) {
  const rows = uniqueById(values);
  if (!rows.length) return "";
  // Incoming fields win (names, posters, synopses do change), except the richer fields
  // only title details provide, which an import must not thin out.
  const merged =
    "(records.body::jsonb || excluded.body::jsonb || jsonb_strip_nulls(jsonb_build_object(" +
    "'genre', records.body::jsonb->'genre', 'seasons', records.body::jsonb->'seasons')))";
  return (
    `insert into records(kind,id,body) values ` +
    rows.map((v) => `(${lit(kind)},${lit(String(v.id))},${json(v)})`).join(",") +
    ` on conflict(kind,id) do update set body=` +
    // merge: see `merged` (hydrated titles keep genre/seasons).
    (merge
      ? `${merged}::text where records.body::jsonb is distinct from ${merged}`
      : `excluded.body where records.body is distinct from excluded.body`)
  );
}
// A row superseded earlier (e.g. by an unfollow) is re-armed when the same reminder is
// enqueued again; delivered rows are never touched, so nothing is delivered twice.
function enqueueRows(rows: any[]) {
  const unique = uniqueById(rows);
  if (!unique.length) return "";
  return (
    `insert into outbox(id,event_id,revision,body) values ` +
    unique
      .map((r) => `(${lit(r.id)},${lit(r.eventId)},${lit(r.revision)},${json(r.body)})`)
      .join(",") +
    ` on conflict(id) do update set state='pending',body=excluded.body where outbox.state='superseded'`
  );
}

// Applies one incoming release to the plan. `prev` is the stored release (or null),
// `subs` the subscriptions read in the same locked transaction.
function planUpsert(
  plan: Plan,
  e: Release,
  prev: Release | null,
  subs: Subscription[],
  now: Date,
) {
  // Observations record what a source said; repeated identical reports add nothing.
  // A manual correction hides the last import, so its signature is kept on the release.
  const blocked = !!prev?.manual && !e.manual;
  const signature = observed(e);
  const last = blocked ? (prev as any).lastImport : prev && observed(prev);
  if (last !== signature)
    plan.observations.push({
      ...e,
      id: randomUUID(),
      observedAt: now.toISOString(),
      eventId: e.id,
    });
  if (blocked) {
    if (last !== signature) plan.releases.push({ ...prev, lastImport: signature });
    return prev;
  }
  const changed = !!prev && material(prev) !== material(e);
  const next = { ...e, revision: prev ? prev.revision + (changed ? 1 : 0) : 1 };
  if (!prev || stable(prev) !== stable(next)) plan.releases.push(next);
  if (changed) plan.supersede.add(e.id);
  const kind = !prev?.date && e.date ? "announced" : changed ? "changed" : null;
  if (kind)
    for (const s of subs)
      if (matches(s, next) && s.rules.includes(kind))
        plan.outbox.push(outboxRow(s, next, kind, now));
  return next;
}
function planStatements(plan: Plan) {
  return [
    upsertRecords("releases", plan.releases),
    upsertRecords("observations", plan.observations),
    // Must run before the enqueue so it only touches older rows.
    plan.supersede.size
      ? `update outbox set state='superseded' where state='pending' and event_id in (${list([...plan.supersede])})`
      : "",
    enqueueRows(plan.outbox),
  ];
}

// Transaction pooler compatibility: no prepared statements, small per-instance pool.
// Certificate and hostname verification stay enabled (Node's defaults with rejectUnauthorized).
export function openPostgresStore(url: string) {
  const sql = postgres(url, {
    prepare: false,
    max: 2,
    ssl:
      process.env.PG_TEST_LOCAL === "true" &&
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1"].includes(new URL(url).hostname)
        ? false
        : { ca: [...rootCertificates, SUPABASE_ROOT_CA] },
    connect_timeout: 10,
    // Reconnecting (TLS + auth) costs several round trips, so keep idle connections longer.
    idle_timeout: 300,
  });
  const LOCK = 76190231;
  const run = (text: string): Promise<any> => sql.unsafe(text) as any;
  const db = {
    sql,
    close: () => sql.end(),
    // One statement: the update and the session purge commit together.
    changeCredentials: (salt: string, hash: string) =>
      sql`with u as (update account set salt=${salt}, password_hash=${hash} where id='owner' returning id) delete from sessions`,
  };
  // Writes that need no read run as one message in an implicit transaction: one round trip.
  const lockedRun = (statements: string[]) =>
    run(
      [`select pg_advisory_xact_lock(${LOCK})`, ...statements.filter(Boolean)].join(";\n"),
    );
  // Locked read-modify-write in two round trips: BEGIN + lock + read in one message,
  // then the planned writes + COMMIT in a second. `read` ends with a SELECT whose rows
  // are passed to `plan`.
  async function atomic<T>(
    read: string,
    plan: (rows: any[]) => { statements: string[]; result: T },
  ): Promise<T> {
    const conn = await sql.reserve();
    let open = true;
    try {
      const rows = lastResult(
        await conn.unsafe(`begin; select pg_advisory_xact_lock(${LOCK}); ${read}`),
      );
      const { statements, result } = plan(rows);
      await conn.unsafe([...statements.filter(Boolean), "commit"].join(";\n"));
      open = false;
      return result;
    } finally {
      if (open) await conn.unsafe("rollback").catch(() => {});
      conn.release();
    }
  }
  const all = async (kind: string): Promise<any[]> =>
    parse(await run(`select body from records where kind=${lit(kind)}`));
  const get = async (kind: string, id: string): Promise<any> => {
    const rows = await run(
      `select body from records where kind=${lit(kind)} and id=${lit(String(id))}`,
    );
    return rows[0] ? JSON.parse(rows[0].body) : null;
  };
  // Reads several record kinds in one round trip.
  const allKinds = async (kinds: string[]) => {
    const out: Record<string, any[]> = Object.fromEntries(kinds.map((k) => [k, []]));
    for (const r of await run(`select kind, body from records where kind in (${list(kinds)})`))
      out[r.kind].push(JSON.parse(r.body));
    return out;
  };
  // Subscriptions plus the stored versions of the given releases, for planUpsert.
  const releaseContext = (ids: string[]) =>
    `select kind, body from records where kind='subscriptions'` +
    (ids.length ? ` or (kind='releases' and id in (${list(ids)}))` : "");
  const splitContext = (rows: any[]) => {
    const subs: Subscription[] = [];
    const prev = new Map<string, Release>();
    for (const r of rows) {
      const v = JSON.parse(r.body);
      if (r.kind === "subscriptions") subs.push(v);
      else if (r.kind === "releases") prev.set(v.id, v);
    }
    return { subs, prev };
  };
  // Plans a batch of release upserts against context rows read under the lock.
  const planAll = (rows: any[], releases: Release[]) => {
    const { subs, prev } = splitContext(rows);
    const plan: Plan = { releases: [], observations: [], supersede: new Set(), outbox: [] };
    const now = new Date();
    const results = releases.map((e) => {
      const next = planUpsert(plan, e, prev.get(e.id) || null, subs, now);
      prev.set(e.id, next);
      return next;
    });
    return { statements: planStatements(plan), results };
  };
  const releaseIds = (releases: Release[]) => [...new Set(releases.map((e) => e.id))];
  // createdAt of an existing subscription is preserved in SQL.
  const followStatement = (s: any) =>
    `insert into records(kind,id,body) values('subscriptions',${lit(s.id)},${json(s)}) ` +
    `on conflict(kind,id) do update set body=jsonb_set(excluded.body::jsonb,'{createdAt}',` +
    `coalesce(records.body::jsonb->'createdAt',excluded.body::jsonb->'createdAt'))::text`;
  // Reminder checks only need to rerun when their inputs change or time moves on.
  const tickInputs = new Set(["settings", "releases", "subscriptions"]);
  let lastTick = 0,
    dirty = true;
  return {
    db,
    sql,
    all,
    get,
    allKinds,
    put: async (kind: string, v: any) => {
      if (tickInputs.has(kind)) dirty = true;
      await run(upsertRecords(kind, [v]));
    },
    // Writes many records in one statement. merge: stored fields win over incoming ones.
    putMany: async (kind: string, values: any[], options: { merge?: boolean } = {}) => {
      if (!values.length) return;
      if (tickInputs.has(kind)) dirty = true;
      await run(upsertRecords(kind, values, options));
    },
    upsert: async (e: Release): Promise<Release> => {
      dirty = true;
      return atomic(releaseContext([e.id]), (rows) => {
        const { statements, results } = planAll(rows, [e]);
        return { statements, result: results[0] };
      });
    },
    // TMDB import: titles, releases and health in one locked transaction (2 round trips).
    // Titles merge so fields from hydration (genre, seasons) are not clobbered.
    importReleases: async (titles: any[], releases: Release[], health: any) => {
      dirty = true;
      await atomic(releaseContext(releaseIds(releases)), (rows) => ({
        statements: [
          upsertRecords("titles", titles, { merge: true }),
          ...planAll(rows, releases).statements,
          upsertRecords("health", [health]),
        ],
        result: undefined,
      }));
    },
    // Default settings on first run (a concurrent cold start inserts nothing).
    ensureSettings: async (settings: any) => {
      dirty = true;
      await run(
        `insert into records(kind,id,body) values('settings',${lit(settings.id)},${json(settings)}) on conflict(kind,id) do nothing`,
      );
    },
    // Locked (still one message) so a reminder check can't act on the rules it replaces.
    follow: async (s: any) => {
      dirty = true;
      await lockedRun([followStatement(s)]);
    },
    // First follow of a title: stores the title and its dates with the subscription.
    // The dates are planned against the subscriptions read before this one is added,
    // so saving a title's current dates is a baseline, never an "announced" reminder.
    track: async (entry: Entry, s: any) => {
      dirty = true;
      await atomic(releaseContext(releaseIds(entry.releases)), (rows) => ({
        statements: [
          upsertRecords("titles", [entry.title]),
          ...planAll(rows, entry.releases).statements,
          followStatement(s),
        ],
        result: undefined,
      }));
    },
    // Re-checked dates of followed titles (2 round trips). Changes become observations
    // and "changed"/"announced" reminders; titles unfollowed meanwhile are skipped.
    refresh: async (entries: Entry[]) => {
      dirty = true;
      const ids = releaseIds(entries.flatMap((e) => e.releases));
      return atomic(releaseContext(ids) + ` or kind='titles'`, (rows) => {
        const stored = new Set(
          rows.filter((r) => r.kind === "titles").map((r) => JSON.parse(r.body).id),
        );
        const live = entries.filter((e) => stored.has(e.title.id));
        return {
          statements: [
            upsertRecords("titles", live.map((e) => e.title)),
            ...planAll(rows, live.flatMap((e) => e.releases)).statements,
          ],
          result: live.length,
        };
      });
    },
    // Title existence and the subscription a follow request refers to, in one round trip.
    followContext: async (titleId: string, subscriptionId: string | null) => {
      const [row] = await run(
        `select exists(select 1 from records where kind='titles' and id=${lit(titleId)}) as title, ` +
          `(select body from records where kind='subscriptions' and id=${lit(subscriptionId)}) as sub`,
      );
      return { title: !!row.title, sub: row.sub ? JSON.parse(row.sub) : null };
    },
    // The last unfollow of a title also deletes the title, its dates and their history
    // (notifications keep the title's name). One statement: every part sees the rows as
    // they were before the subscription is deleted, hence `s.id<>id`.
    unfollow: async (id: string) => {
      dirty = true;
      await lockedRun([
        `with d as (delete from records where kind='subscriptions' and id=${lit(id)} returning body::jsonb->>'titleId' as title), ` +
          `o as (update outbox set state='superseded' where state='pending' and body::jsonb->>'subscriptionId'=${lit(id)}) ` +
          `delete from records r using d where ((r.kind='titles' and r.id=d.title) or ` +
          `(r.kind in ('releases','observations') and r.body::jsonb->>'titleId'=d.title)) and not exists(` +
          `select 1 from records s where s.kind='subscriptions' and s.id<>${lit(id)} and s.body::jsonb->>'titleId'=d.title)`,
      ]);
    },
    // One statement: the given notifications, or every unread one when ids is omitted.
    markNotificationsRead: async (ids?: string[]) => {
      if (ids && !ids.length) return;
      await run(
        `update records set body=(body::jsonb || '{"read":true}')::text where kind='notifications' and (body::jsonb->>'read') is distinct from 'true'` +
          (ids ? ` and id in (${list(ids)})` : ""),
      );
    },
    // Everything the app shell needs in one round trip; notifications are capped to the
    // latest 100 and returned oldest first.
    stateData: async () => {
      const kinds = ["titles", "releases", "subscriptions", "settings", "health"];
      const out: Record<string, any[]> = Object.fromEntries(
        [...kinds, "notifications"].map((k) => [k, []]),
      );
      const rows = await run(
        `select kind, body from records where kind in (${list(kinds)}) union all ` +
          `(select kind, body from records where kind='notifications' order by body::jsonb->>'createdAt' desc, id desc limit 100)`,
      );
      for (const r of rows) out[r.kind].push(JSON.parse(r.body));
      out.notifications.sort(
        (a, b) =>
          String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
          String(a.id).localeCompare(String(b.id)),
      );
      return out;
    },
    atomic,
    tick,
    // For page loads: rerun only after a relevant write or once a minute.
    tickIfStale: async () => {
      if (!dirty && Date.now() - lastTick < 60000) return;
      dirty = false;
      await tick().catch((err) => {
        dirty = true;
        throw err;
      });
    },
  };
  // Two round trips: lock + read everything, then enqueue + deliver + health + commit.
  function tick(now = new Date()) {
    lastTick = Date.now();
    return atomic(
      `select kind, body from records where kind in ('settings','health','releases','subscriptions')`,
      (rows) => {
        const data: Record<string, any[]> = { settings: [], health: [], releases: [], subscriptions: [] };
        for (const r of rows) data[r.kind].push(JSON.parse(r.body));
        const settings = data.settings.find((x) => x.id === "user") || {
          timezone: "Asia/Colombo",
          hour: 9,
        };
        const previous = data.health.find((x) => x.id === "scheduler");
        // Bounded catch-up for missed checks, capped at seven days. Initial run starts now.
        const start = previous
          ? Math.max(Date.parse(previous.updatedAt), now.getTime() - 7 * 86400000)
          : now.getTime();
        const checks = [now];
        for (let t = start; t < now.getTime(); t += 3600000) checks.push(new Date(t));
        const enqueue: any[] = [];
        // Every (subscription, event, revision, kind) a pending row may be delivered for.
        const valid: string[] = [];
        for (const s of data.subscriptions)
          for (const e of data.releases)
            if (matches(s, e))
              for (const kind of s.rules) {
                valid.push(`(${list([s.id, e.id, kind])},${lit(e.revision)})`);
                if (
                  ["week", "day", "release"].includes(kind) &&
                  checks.some(
                    (t) =>
                      (!(s as any).createdAt || t.getTime() >= Date.parse((s as any).createdAt)) &&
                      due(e, kind, t, settings.timezone, settings.hour),
                  )
                )
                  enqueue.push(outboxRow(s, e, kind, now));
              }
        const isValid = valid.length
          ? `(outbox.body::jsonb->>'subscriptionId', outbox.event_id, outbox.body::jsonb->>'kind', outbox.revision) in (values ${valid.join(",")})`
          : "false";
        return {
          statements: [
            enqueueRows(enqueue),
            // Deliver valid pending rows (existing notifications keep their read flag),
            // then settle every pending row as delivered or superseded.
            // The title's name is copied so the notification outlives an unfollow.
            `insert into records(kind,id,body) select 'notifications', outbox.id, (outbox.body::jsonb || jsonb_build_object('read', false, 'titleName', t.body::jsonb->>'name'))::text ` +
              `from outbox left join records t on t.kind='titles' and t.id=outbox.body::jsonb->>'titleId' ` +
              `where outbox.state='pending' and ${isValid} on conflict(kind,id) do nothing`,
            `update outbox set state=case when ${isValid} then 'delivered' else 'superseded' end where state='pending'`,
            upsertRecords("health", [{ id: "scheduler", state: "ok", updatedAt: now.toISOString() }]),
          ],
          result: undefined,
        };
      },
    );
  }
}
export type Store = ReturnType<typeof openPostgresStore>;
