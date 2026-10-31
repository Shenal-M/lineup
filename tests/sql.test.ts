import { test } from "node:test";
import assert from "node:assert/strict";
import { lit } from "../src/postgres-store.ts";
import { clientAddress } from "../src/auth.ts";

test("SQL literals are escaped like PQescapeLiteral", () => {
  assert.equal(lit(null), "null");
  assert.equal(lit(undefined), "null");
  assert.equal(lit(3), "3");
  assert.equal(lit(true), "true");
  assert.equal(lit("a'b"), "E'a''b'");
  assert.equal(lit("a\\'b"), "E'a\\\\''b'");
  assert.throws(() => lit(NaN));
  assert.throws(() => lit("a\0b"));
  assert.throws(() => lit({}));
});

test("client address prefers the first forwarded entry", () => {
  assert.equal(
    clientAddress({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }),
    "203.0.113.5",
  );
  assert.equal(clientAddress({ "x-real-ip": "198.51.100.7" }), "198.51.100.7");
  assert.equal(clientAddress({}), "unknown");
});
