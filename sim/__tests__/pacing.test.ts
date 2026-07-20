import { test } from "node:test";
import assert from "node:assert/strict";
import { humanDelayMs } from "../pacing";

test("humanDelayMs stays within 2000-8000", () => {
  for (let i = 0; i < 1000; i++) {
    const d = humanDelayMs();
    assert.ok(d >= 2000 && d <= 8000, `got ${d}`);
  }
});
