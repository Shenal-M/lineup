import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
      await s.sql.unsafe(
        await readFile(
          new URL(
            "../supabase/migrations/202610290001_lineup.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
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
