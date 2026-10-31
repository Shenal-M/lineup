import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pushPayload,
  pushSubscriptionFrom,
  pushSubscriptionId,
  pushTargets,
} from "../src/push.ts";

const year = new Date().getUTCFullYear();

test("push payload reads like the reminder email, with a short date", () => {
  const p = pushPayload(
    {
      id: "s:e:1:day",
      kind: "day",
      titleName: "The Gilded Age",
      date: `${year}-11-01`,
      medium: "streaming",
      service: "HBO Max",
    },
    { season: 4, precision: "day" },
  );
  const day = new Date(`${year}-11-01T12:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  assert.equal(p.title, "Coming tomorrow: The Gilded Age");
  assert.equal(p.body, `Season 4 · HBO Max · ${day}, Nov 1`);
  assert.equal(p.tag, "s:e:1:day");
  assert.equal(p.url, "/following");
});

test("push payload without a stored release or title name still reads well", () => {
  const p = pushPayload({
    id: "n",
    kind: "announced",
    date: `${year + 1}-03-01`,
    medium: "theatrical",
  });
  assert.equal(p.title, "Date announced: Your followed title");
  // Another year's date carries the year.
  assert.match(p.body, new RegExp(`^In cinemas · \\w{3}, Mar 1, ${year + 1}$`));
});

test("only recent notifications created after a device subscribed are pushed", () => {
  const now = Date.parse("2026-11-01T10:00:00Z");
  const old = { id: "old", createdAt: "2026-10-30T10:00:00Z" },
    before = { id: "before", createdAt: "2026-11-01T07:00:00Z" },
    after = { id: "after", createdAt: "2026-11-01T09:00:00Z" };
  const phone = { id: "phone", createdAt: "2026-11-01T08:00:00Z" },
    laptop = { id: "laptop", createdAt: "2026-10-01T00:00:00Z" };
  const pairs = pushTargets([old, before, after], [phone, laptop], now).map(
    ({ n, s }) => `${n.id}->${s.id}`,
  );
  assert.deepEqual(pairs, ["before->laptop", "after->phone", "after->laptop"]);
});

test("push subscriptions are validated and keyed by endpoint", () => {
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc:def",
    expirationTime: null,
    keys: { p256dh: "BNc-x_y", auth: "a1b2c3" },
    extra: "dropped",
  };
  assert.deepEqual(pushSubscriptionFrom(sub), {
    endpoint: sub.endpoint,
    keys: sub.keys,
  });
  assert.equal(pushSubscriptionId(sub.endpoint), pushSubscriptionId(sub.endpoint));
  assert.equal(pushSubscriptionId(sub.endpoint).length, 64);
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/x",
    "https://169.254.169.254/latest",
    "https://evil.example.com/push",
    "not a url",
  ])
    assert.throws(() => pushSubscriptionFrom({ ...sub, endpoint }), /Invalid push subscription/);
  assert.throws(
    () => pushSubscriptionFrom({ ...sub, keys: { p256dh: "x'; drop", auth: "a" } }),
    /Invalid push subscription/,
  );
});
