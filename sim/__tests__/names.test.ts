import { test } from "node:test";
import assert from "node:assert/strict";
import { assignNames, NAME_POOL } from "../names.ts";

test("returns the requested count", () => {
  assert.equal(assignNames(8).length, 8);
});

test("names are unique", () => {
  const names = assignNames(10);
  assert.equal(new Set(names).size, 10);
});

test("pool covers the game's max of 10", () => {
  assert.ok(NAME_POOL.length >= 10);
});

test("throws when asked for more than the pool", () => {
  assert.throws(() => assignNames(NAME_POOL.length + 1), /pool/);
});
