import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { openPostgresStore } from "../src/postgres-store.ts";
import { createAuth } from "../src/auth.ts";
import { seed } from "../src/seed.ts";
import { deliverEmails } from "../src/email.ts";
const url = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL persistence, concurrency, catch-up, email retry and auth",
  { skip: !url },
  async (t) => {
    const parsed = new URL(url!);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
        parsed.pathname === "/lineup_test",
      "Use a disposable local lineup_test database only",
    );
    process.env.PG_TEST_LOCAL = "true";
    const s = openPostgresStore(url!);
    try {
      const migrations = new URL("../supabase/migrations/", import.meta.url);
      for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort())
        await s.sql.unsafe(await readFile(new URL(file, migrations), "utf8"));
      await s.sql`truncate records,outbox,account,sessions,auth_attempts,email_deliveries`;
      await seed(s);
      const sub = {
        id: "test-sub",
        titleId: "dog-stars",
        market: "US",
        medium: "streaming",
        services: ["Netflix"],
        rules: ["announced", "changed", "day", "release"],
        createdAt: "2026-10-01T00:00:00Z",
      };
      const event = {
        id: "test-release",
        titleId: "dog-stars",
        market: "US",
        medium: "streaming" as const,
        service: "Netflix",
        offer: "subscription",
        date: "2026-11-13",
        precision: "day" as const,
        status: "announced" as const,
        source: "Test",
        sourceUrl: "",
        revision: 1,
      };
      const auth = createAuth(s.db);
      let cookie = "";
      const res = {
        setHeader: (_k: string, v: string) => {
          cookie = v.split(";")[0];
        },
      };
      await t.test(
        "owner and cookie sessions persist across connections",
        async () => {
          await auth.setup("owner@example.com", "a-long-test-password", res);
          assert.equal(await auth.authenticated({ headers: { cookie } }), true);
          const another = openPostgresStore(url!);
          try {
            assert.deepEqual(await createAuth(another.db).user(), {
              email: "owner@example.com",
            });
          } finally {
            await another.db.close();
          }
          assert.equal(
            (await auth.signIn("owner@example.com", "wrong", "test", res))
              .status,
            401,
          );
          assert.equal(
            (
              await auth.signIn(
                "owner@example.com",
                "a-long-test-password",
                "test",
                res,
              )
            ).user?.email,
            "owner@example.com",
          );
        },
      );
      await t.test(
        "parallel release writes preserve revisions and manual corrections",
        async () => {
          await s.put("subscriptions", sub);
          await s.upsert({ ...event, date: null, precision: "unknown" });
          await s.upsert(event);
          const revisions = await Promise.all(
            ["2026-11-14", "2026-11-15"].map((date) =>
              s.upsert({ ...event, date, manual: true }),
            ),
          );
          assert.deepEqual(revisions.map((r) => r.revision).sort(), [3, 4]);
          const kept = await s.upsert(event);
          assert.equal(kept.revision, 4);
          await s.tick(new Date("2026-10-29T00:00Z"));
          const notes = await s.all("notifications");
          assert.equal(notes.length, 1);
          assert.equal(notes[0].kind, "changed");
        },
      );
      process.env.RESEND_API_KEY = "test-only";
      process.env.EMAIL_FROM = "Lineup <test@example.com>";
      let calls = 0;
      const keys: string[] = [];
      const sender: typeof fetch = async (_url, options) => {
        calls++;
        keys.push(
          (options?.headers as Record<string, string>)["Idempotency-Key"],
        );
        const payload = JSON.parse(String(options?.body));
        assert.deepEqual(payload.to, ["owner@example.com"]);
        assert.ok(payload.subject.includes("The Dog Stars"));
        return calls === 1
          ? new Response("", { status: 429 })
          : Response.json({ id: "mock-email-id" });
      };
      await t.test(
        "failed sends retry with the same key and concurrent jobs send once",
        async () => {
          assert.equal((await deliverEmails(s, sender)).failed, 1);
          const results = await Promise.all([
            deliverEmails(s, sender),
            deliverEmails(s, sender),
          ]);
          assert.equal(
            results.reduce((n, r) => n + r.sent, 0),
            1,
          );
          assert.equal(calls, 2);
          assert.equal(keys[0], keys[1]);
          assert.equal((await deliverEmails(s, sender)).sent, 0);
        },
      );
      await t.test(
        "expired idempotency window requires review instead of duplicate send",
        async () => {
          await s.sql`update email_deliveries set sent_at=null,first_attempt=${Date.now() - 24 * 3600000}`;
          assert.equal((await deliverEmails(s, sender)).review, 1);
          assert.equal(calls, 2);
        },
      );
      await t.test(
        "hourly worker catches up across a missed local reminder day and deduplicates",
        async () => {
          await s.upsert({ ...event, id: "catchup", date: "2026-11-13" });
          await s.put("health", {
            id: "scheduler",
            updatedAt: "2026-11-11T00:00Z",
          });
          await s.tick(new Date("2026-11-13T06:00Z"));
          const notes = (await s.all("notifications")).filter(
            (n) => n.eventId === "catchup",
          );
          assert.ok(notes.some((n) => n.kind === "day"));
          assert.ok(notes.some((n) => n.kind === "release"));
          await s.tick(new Date("2026-11-13T08:00Z"));
          assert.equal(
            (await s.all("notifications")).filter(
              (n) => n.eventId === "catchup",
            ).length,
            notes.length,
          );
        },
      );
      await t.test("unfollowing suppresses queued email", async () => {
        await s.unfollow(sub.id);
        const before = calls;
        await deliverEmails(s, sender);
        assert.equal(calls, before);
      });
      await t.test("password changes revoke other sessions", async () => {
        const oldCookie = cookie;
        await auth.changePassword(
          "a-long-test-password",
          "another-long-password",
          "test",
          res,
        );
        assert.equal(
          await auth.authenticated({ headers: { cookie: oldCookie } }),
          false,
        );
        assert.equal(await auth.authenticated({ headers: { cookie } }), true);
      });
    } finally {
      await s.db.close();
    }
  },
);
test("release store semantics", { skip: !url }, async (t) => {
  process.env.PG_TEST_LOCAL = "true";
  const s = openPostgresStore(url!);
  const event = {
    id: "r",
    titleId: "t",
    market: "US",
    medium: "streaming" as const,
    service: "Netflix",
    offer: "subscription",
    date: "2026-11-13",
    precision: "day" as const,
    status: "announced" as const,
    source: "Official announcement",
    sourceUrl: "https://example.com",
    revision: 1,
  };
  const sub = {
    id: "s",
    titleId: "t",
    market: "US",
    medium: "streaming" as const,
    services: [] as string[],
    rules: ["announced", "changed", "week", "day", "release"],
  };
  const fresh = () =>
    s.sql`truncate records,outbox,account,sessions,auth_attempts,email_deliveries`;
  try {
    await t.test("follow before a date exists receives later announcement once", async () => {
      await fresh();
      await s.put("subscriptions", sub);
      await s.upsert({ ...event, date: null, precision: "unknown" });
      await s.tick();
      assert.equal((await s.all("notifications")).length, 0);
      await s.upsert(event);
      await s.tick(new Date("2026-10-01T00:00Z"));
      await s.tick(new Date("2026-10-01T00:00Z"));
      const notes = await s.all("notifications");
      assert.equal(notes.length, 1);
      assert.equal(notes[0].kind, "announced");
    });
    await t.test("postponement supersedes pending older alerts", async () => {
      await fresh();
      await s.put("subscriptions", sub);
      await s.upsert(event);
      await s.upsert({ ...event, date: "2026-12-01", status: "postponed" });
      await s.tick(new Date("2026-11-13T04:00Z"));
      await s.tick(new Date("2026-11-13T04:00Z"));
      const notes = await s.all("notifications");
      assert.equal(notes.length, 1);
      assert.equal(notes[0].kind, "changed");
      const [old] = await s.sql`select state from outbox where revision=1`;
      assert.equal(old.state, "superseded");
    });
    await t.test("metadata edits do not advance revision; manual corrections survive imports", async () => {
      await fresh();
      await s.upsert(event);
      assert.equal((await s.upsert({ ...event, source: "Updated attribution" })).revision, 1);
      await s.upsert({ ...event, date: "2026-12-01", manual: true });
      const kept = await s.upsert(event);
      assert.equal(kept.date, "2026-12-01");
      assert.equal(kept.revision, 2);
      assert.equal((await s.all("observations")).length, 4);
    });
    await t.test("selected service follow remains waiting when another service arrives", async () => {
      await fresh();
      await s.put("subscriptions", { ...sub, services: ["Apple TV"] });
      await s.upsert(event);
      await s.tick(new Date("2026-11-13T04:00Z"));
      assert.equal((await s.all("notifications")).length, 0);
    });
    await t.test("release-day reminders are deduplicated across repeated checks", async () => {
      await fresh();
      await s.upsert(event);
      await s.put("subscriptions", sub);
      await s.tick(new Date("2026-11-13T04:00Z"));
      await s.tick(new Date("2026-11-13T06:00Z"));
      const notes = await s.all("notifications");
      assert.equal(notes.length, 1);
      assert.equal(notes[0].kind, "release");
    });
    await t.test("channel follows coexist and only notify for their own service", async () => {
      await fresh();
      await s.put("subscriptions", { ...sub, id: "netflix", services: ["Netflix"] });
      await s.put("subscriptions", { ...sub, id: "apple", services: ["Apple TV"] });
      await s.upsert(event);
      await s.tick(new Date("2026-10-01T00:00Z"));
      let notes = await s.all("notifications");
      assert.equal(notes.length, 1);
      assert.equal(notes[0].subscriptionId, "netflix");
      await s.unfollow("netflix");
      await s.upsert({ ...event, id: "apple-event", service: "Apple TV" });
      await s.tick(new Date("2026-10-01T00:00Z"));
      notes = await s.all("notifications");
      assert.equal(notes.length, 2);
      const subs = await s.all("subscriptions");
      assert.deepEqual(subs.map((x) => x.id), ["apple"]);
    });
  } finally {
    await s.db.close();
  }
});
test("round-trip optimised store writes", { skip: !url }, async (t) => {
  const parsed = new URL(url!);
  assert.ok(
    ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.pathname === "/lineup_test",
    "Use a disposable local lineup_test database only",
  );
  process.env.PG_TEST_LOCAL = "true";
  const s = openPostgresStore(url!);
  const event = {
    id: "r",
    titleId: "t",
    market: "US",
    medium: "streaming" as const,
    service: "Netflix",
    offer: "subscription",
    date: "2026-11-13",
    precision: "day" as const,
    status: "announced" as const,
    source: "Official announcement",
    sourceUrl: "https://example.com",
    revision: 1,
  };
  const sub = {
    id: "s",
    titleId: "t",
    market: "US",
    medium: "streaming" as const,
    services: [] as string[],
    rules: ["announced", "changed", "week", "day", "release"],
  };
  const fresh = () =>
    s.sql`truncate records,outbox,account,sessions,auth_attempts,email_deliveries`;
  try {
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort())
      await s.sql.unsafe(await readFile(new URL(file, migrations), "utf8"));

    await t.test("marking notifications read is one update and survives ticks", async () => {
      await fresh();
      await s.put("subscriptions", sub);
      await s.upsert(event);
      await s.tick(new Date("2026-10-01T00:00Z"));
      assert.equal((await s.all("notifications")).filter((n) => !n.read).length, 1);
      await s.markNotificationsRead();
      const notes = await s.all("notifications");
      assert.equal(notes.length, 1);
      assert.equal(notes[0].read, true);
      assert.equal(notes[0].kind, "announced");
      await s.tick(new Date("2026-10-01T01:00Z"));
      assert.equal((await s.all("notifications"))[0].read, true);
    });

    await t.test("marking selected notifications read leaves others unread", async () => {
      await fresh();
      await s.putMany("notifications", [
        { id: "a", createdAt: "2026-01-01T00:00:00Z", read: false },
        { id: "b", createdAt: "2026-01-02T00:00:00Z", read: false },
      ]);
      await s.markNotificationsRead(["a", "missing"]);
      await s.markNotificationsRead([]);
      const read = Object.fromEntries((await s.all("notifications")).map((n) => [n.id, n.read]));
      assert.deepEqual(read, { a: true, b: false });
    });

    await t.test("re-following re-arms superseded reminders without duplicates", async () => {
      await fresh();
      const follow = () => s.follow({ ...sub, createdAt: "2026-10-01T00:00:00Z" });
      await follow();
      await s.upsert(event);
      await s.tick(new Date("2026-11-12T04:00Z")); // "announced" + "day" delivered
      await s.unfollow(sub.id);
      // Queue the release-day reminder, then supersede it by unfollowing.
      await follow();
      await s.sql`insert into outbox(id,event_id,revision,body,state) values('s:r:1:release','r',1,${JSON.stringify({ id: "s:r:1:release", subscriptionId: "s", eventId: "r", titleId: "t", kind: "release", date: event.date, medium: event.medium, service: event.service, createdAt: "2026-11-13T00:00:00Z" })},'pending')`;
      await s.unfollow(sub.id);
      assert.equal(
        (await s.sql`select state from outbox where id='s:r:1:release'`)[0].state,
        "superseded",
      );
      await follow();
      await s.tick(new Date("2026-11-13T04:00Z"));
      await s.tick(new Date("2026-11-13T05:00Z"));
      const kinds = (await s.all("notifications")).map((n) => n.kind).sort();
      assert.deepEqual(kinds, ["announced", "day", "release"]);
      const states = await s.sql`select state, count(*)::int as n from outbox group by state order by state`;
      assert.deepEqual(
        states.map((r) => [r.state, r.n]),
        [["delivered", 3]],
      );
    });

    await t.test("follow preserves createdAt of an existing subscription", async () => {
      await fresh();
      await s.follow({ ...sub, createdAt: "2026-01-01T00:00:00.000Z" });
      await s.follow({ ...sub, rules: ["day"], createdAt: "2026-06-01T00:00:00.000Z" });
      const [stored] = await s.all("subscriptions");
      assert.equal(stored.createdAt, "2026-01-01T00:00:00.000Z");
      assert.deepEqual(stored.rules, ["day"]);
      assert.deepEqual(await s.followContext("missing", sub.id), {
        title: false,
        sub: stored,
      });
    });

    await t.test("bulk title merge does not clobber richer stored fields", async () => {
      await fresh();
      await s.put("titles", {
        id: "x",
        name: "X",
        genre: "Drama · Mystery",
        seasons: [{ number: 1 }],
      });
      await s.putMany(
        "titles",
        [
          { id: "x", name: "X (search)", genre: "TV series", poster: "p.jpg" },
          { id: "y", name: "Y", genre: "Movie" },
          { id: "y", name: "Y2", genre: "Movie" },
        ],
        { merge: true },
      );
      const x = await s.get("titles", "x");
      assert.equal(x.genre, "Drama · Mystery");
      assert.equal(x.name, "X (search)");
      assert.equal(x.poster, "p.jpg");
      assert.deepEqual(x.seasons, [{ number: 1 }]);
      assert.equal((await s.get("titles", "y")).name, "Y2");
    });

    await t.test("inlined literals with quotes and backslashes round-trip", async () => {
      await fresh();
      const tricky = "O'Brien \\'); drop table records; -- \\\\ é 🎬";
      await s.put("titles", { id: tricky, name: tricky });
      assert.equal((await s.get("titles", tricky)).name, tricky);
      await assert.rejects(s.put("titles", { id: "nul\0", name: "x" }));
    });

    await t.test("state data caps notifications to the latest 100, oldest first", async () => {
      await fresh();
      await s.putMany(
        "notifications",
        Array.from({ length: 105 }, (_, i) => ({
          id: `n${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
          read: false,
        })),
      );
      const data = await s.stateData();
      assert.equal(data.notifications.length, 100);
      assert.equal(data.notifications[0].id, "n5");
      assert.equal(data.notifications[99].id, "n104");
    });

    await t.test("identical imports over a manual correction are observed once", async () => {
      await fresh();
      const imported = { ...event, medium: "theatrical" as const, service: null, offer: "ticket" };
      const health = { id: "tmdb", state: "ok" };
      await s.importReleases([], [imported], health);
      await s.upsert({ ...imported, date: "2026-12-01", manual: true });
      for (let i = 0; i < 3; i++) await s.importReleases([], [imported], health);
      // first import, manual edit, first blocked import; repeats add nothing
      assert.equal((await s.all("observations")).length, 3);
      assert.equal((await s.get("releases", "r")).date, "2026-12-01");
    });
    await t.test("search and import refresh stored titles but keep hydrated fields", async () => {
      await fresh();
      await s.put("titles", { id: "t", name: "Old", genre: "Hydrated", seasons: [{ number: 1 }] });
      await s.putMany("titles", [{ id: "t", name: "New", genre: "Movie" }], { merge: true });
      const title = await s.get("titles", "t");
      assert.equal(title.name, "New");
      assert.equal(title.genre, "Hydrated");
      assert.deepEqual(title.seasons, [{ number: 1 }]);
    });
    await t.test("import observes only changes and merges titles", async () => {
      await fresh();
      await s.put("titles", { id: "t", name: "T", genre: "Hydrated" });
      const imported = {
        ...event,
        medium: "theatrical" as const,
        service: null,
        offer: "ticket",
      };
      const health = { id: "tmdb", state: "ok" };
      await s.importReleases([{ id: "t", name: "T", genre: "Movie" }], [imported], health);
      await s.importReleases([{ id: "t", name: "T", genre: "Movie" }], [imported], health);
      assert.equal((await s.all("observations")).length, 1);
      assert.equal((await s.get("titles", "t")).genre, "Hydrated");
      await s.importReleases([], [{ ...imported, date: "2026-11-20" }], health);
      assert.equal((await s.get("releases", "r")).revision, 2);
      assert.equal((await s.all("observations")).length, 2);
      assert.equal((await s.get("health", "tmdb")).state, "ok");
    });

    await t.test("seeding is a no-op once settings exist", async () => {
      await fresh();
      await seed(s);
      const count = (await s.all("titles")).length;
      assert.ok(count > 0);
      await s.put("settings", { id: "user", market: "GB", timezone: "Europe/London", hour: 8 });
      await seed(s);
      assert.equal((await s.all("titles")).length, count);
      assert.equal((await s.get("settings", "user")).market, "GB");
    });

    await t.test("rate limiting takes a slot per attempt, per address and globally", async () => {
      await fresh();
      const auth = createAuth(s.db);
      const res = { setHeader: () => {} };
      await auth.setup("owner@example.com", "a-long-test-password", res);
      for (let i = 0; i < 10; i++)
        assert.equal(
          (await auth.signIn("owner@example.com", "wrong", "1.1.1.1", res)).status,
          401,
        );
      // Refused before the password is checked, even when it is correct.
      assert.equal(
        (await auth.signIn("owner@example.com", "a-long-test-password", "1.1.1.1", res)).status,
        429,
      );
      // Another address is still allowed; success frees its slot and its global slot.
      assert.equal(
        (await auth.signIn("owner@example.com", "a-long-test-password", "2.2.2.2", res)).status,
        200,
      );
      const rows = await s.sql`select address, count from auth_attempts order by address`;
      assert.deepEqual(
        rows.map((r) => [r.address, r.count]),
        [
          ["global", 11],
          ["ip:1.1.1.1", 11],
        ],
      );
      // Past the global cap attempts are slowed, not refused, so the owner still gets in.
      await s.sql`update auth_attempts set count=50 where address='global'`;
      const started = Date.now();
      assert.equal(
        (await auth.signIn("owner@example.com", "a-long-test-password", "3.3.3.3", res)).status,
        200,
      );
      assert.ok(Date.now() - started >= 1900, "attempt past the global cap is delayed");
    });
  } finally {
    await s.db.close();
  }
});
