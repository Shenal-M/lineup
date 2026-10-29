import postgres from "postgres";
import { randomUUID } from "node:crypto";
import {
  matches,
  material,
  due,
  type Release,
  type Subscription,
} from "./model.ts";

// Transaction pooler compatibility: no prepared statements, small per-instance pool.
// Production certificate verification remains enabled.
export function openPostgresStore(url: string) {
  const sql = postgres(url, {
    prepare: false,
    max: 2,
    ssl:
      process.env.PG_TEST_LOCAL === "true" &&
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1"].includes(new URL(url).hostname)
        ? false
        : "verify-full",
    connect_timeout: 10,
    idle_timeout: 20,
  });
  const LOCK = 76190231;
  const db = {
    prepare: (query: string) => {
      let index = 0;
      const converted = query.replace(/\?/g, () => "$" + ++index);
      return {
        get: async (...args: any[]) => (await sql.unsafe(converted, args))[0],
        run: async (...args: any[]) => {
          // The auth limiter uses SQLite's upsert spelling.
          const q = converted.replace(
            "INSERT OR REPLACE INTO auth_attempts VALUES($1,1,$2)",
            "INSERT INTO auth_attempts VALUES($1,1,$2) ON CONFLICT(address) DO UPDATE SET count=1,reset_at=excluded.reset_at",
          );
          return sql.unsafe(q, args);
        },
      };
    },
    // Schema belongs to migrations, not runtime DDL.
    exec: async (_query: string) => {},
    close: () => sql.end(),
    changeCredentials: async (salt: string, hash: string) =>
      sql.begin(async (tx) => {
        await tx`update account set salt=${salt}, password_hash=${hash} where id='owner'`;
        await tx`delete from sessions`;
      }),
  };
  const allWith = async (tx: any, kind: string): Promise<any[]> =>
    (await tx`select body from records where kind=${kind}`).map((r: any) =>
      JSON.parse(r.body),
    );
  const getWith = async (tx: any, kind: string, id: string): Promise<any> => {
    const rows =
      await tx`select body from records where kind=${kind} and id=${id}`;
    return rows[0] ? JSON.parse(rows[0].body) : null;
  };
  const putWith = async (tx: any, kind: string, v: any) => {
    await tx`insert into records(kind,id,body) values(${kind},${v.id},${JSON.stringify(v)}) on conflict(kind,id) do update set body=excluded.body`;
  };
  const transaction = async (fn: (tx: any) => Promise<any>) =>
    sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK})`;
      return fn(tx);
    });
  const enqueue = async (
    tx: any,
    s: Subscription,
    e: Release,
    kind: string,
    now: Date,
  ) => {
    const id = `${s.id}:${e.id}:${e.revision}:${kind}`;
    const body = {
      id,
      subscriptionId: s.id,
      eventId: e.id,
      titleId: e.titleId,
      kind,
      date: e.date,
      medium: e.medium,
      service: e.service,
      createdAt: now.toISOString(),
    };
    await tx`insert into outbox(id,event_id,revision,body) values(${id},${e.id},${e.revision},${JSON.stringify(body)}) on conflict(id) do nothing`;
  };
  const upsertWith = async (tx: any, e: Release) => {
    const prev = await getWith(tx, "releases", e.id);
    await putWith(tx, "observations", {
      ...e,
      id: randomUUID(),
      observedAt: new Date().toISOString(),
      eventId: e.id,
    });
    if (prev?.manual && !e.manual) return prev;
    const changed = prev && material(prev) !== material(e);
    const next = {
      ...e,
      revision: prev ? prev.revision + (changed ? 1 : 0) : 1,
    };
    await putWith(tx, "releases", next);
    if (changed)
      await tx`update outbox set state='superseded' where event_id=${e.id} and state='pending'`;
    for (const s of await allWith(tx, "subscriptions"))
      if (matches(s, next)) {
        const kind =
          !prev?.date && e.date ? "announced" : changed ? "changed" : null;
        if (kind && s.rules.includes(kind))
          await enqueue(tx, s, next, kind, new Date());
      }
    return next;
  };
  return {
    db,
    sql,
    transaction,
    getWith,
    allWith,
    putWith,
    all: (kind: string) => allWith(sql, kind),
    get: (kind: string, id: string) => getWith(sql, kind, id),
    put: (kind: string, v: any) => transaction((tx) => putWith(tx, kind, v)),
    upsert: (e: Release) => transaction((tx) => upsertWith(tx, e)),
    initializeSeed: (fn: (store: any) => Promise<void>) =>
      transaction((tx) =>
        fn({
          get: (kind: string, id: string) => getWith(tx, kind, id),
          put: (kind: string, v: any) => putWith(tx, kind, v),
          upsert: (e: Release) => upsertWith(tx, e),
        }),
      ),
    tick: (now = new Date()) =>
      transaction(async (tx) => {
        const settings = (await getWith(tx, "settings", "user")) || {
          timezone: "Asia/Colombo",
          hour: 9,
        };
        const previous = await getWith(tx, "health", "scheduler");
        // Bounded catch-up for missed checks, capped at seven days. Initial run starts now.
        const start = previous
          ? Math.max(
              Date.parse(previous.updatedAt),
              now.getTime() - 7 * 86400000,
            )
          : now.getTime();
        const checks = [now];
        for (let t = start; t < now.getTime(); t += 3600000)
          checks.push(new Date(t));
        const releases = await allWith(tx, "releases");
        for (const s of await allWith(tx, "subscriptions"))
          for (const e of releases)
            if (matches(s, e)) {
              for (const kind of ["week", "day", "release"])
                if (
                  s.rules.includes(kind) &&
                  checks.some(
                    (t) =>
                      (!s.createdAt ||
                        t.getTime() >= Date.parse(s.createdAt)) &&
                      due(e, kind, t, settings.timezone, settings.hour),
                  )
                )
                  await enqueue(tx, s, e, kind, now);
            }
        for (const row of await tx`select * from outbox where state='pending'`) {
          const e = await getWith(tx, "releases", row.event_id);
          const body = JSON.parse(row.body);
          const s = await getWith(tx, "subscriptions", body.subscriptionId);
          const valid =
            e &&
            e.revision === row.revision &&
            s &&
            matches(s, e) &&
            s.rules.includes(body.kind);
          if (valid)
            await putWith(tx, "notifications", { ...body, read: false });
          await tx`update outbox set state=${valid ? "delivered" : "superseded"} where id=${row.id}`;
        }
        await putWith(tx, "health", {
          id: "scheduler",
          state: "ok",
          updatedAt: now.toISOString(),
        });
      }),
    unfollow: (id: string) =>
      transaction(async (tx) => {
        await tx`delete from records where kind='subscriptions' and id=${id}`;
        for (const row of await tx`select id,body from outbox where state='pending'`)
          if (JSON.parse(row.body).subscriptionId === id)
            await tx`update outbox set state='superseded' where id=${row.id}`;
      }),
  };
}
