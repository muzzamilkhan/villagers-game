import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseKillTarget, chooseHealTarget, chooseVote } from "../strategy";

test("chooseKillTarget is deterministic (first living non-killer)", () => {
  const list = ["Isolde", "Percival", "Rowena"];
  assert.equal(chooseKillTarget(list), "Isolde");
  assert.equal(chooseKillTarget(list), "Isolde"); // stable across killers
});

test("chooseKillTarget throws when nobody to kill", () => {
  assert.throws(() => chooseKillTarget([]), /no target/);
});

test("chooseHealTarget avoids repeating last heal when possible", () => {
  for (let i = 0; i < 50; i++) {
    const t = chooseHealTarget(["A", "B"], "Self", "A");
    assert.equal(t, "B");
  }
});

test("chooseHealTarget may repeat if it is the only option", () => {
  assert.equal(chooseHealTarget(["A"], "Self", "A"), "A");
});

test("killer votes a living non-killer", () => {
  const killers = ["Alaric", "Beatrix"];
  for (let i = 0; i < 50; i++) {
    const v = chooseVote(["Alaric", "Beatrix", "Rowena", "Godfrey"], "Alaric", killers, true);
    assert.ok(!killers.includes(v), `killer voted a killer: ${v}`);
  }
});

test("villager votes a living player other than self", () => {
  for (let i = 0; i < 50; i++) {
    const v = chooseVote(["Rowena", "Godfrey", "Alaric"], "Rowena", ["Alaric"], false);
    assert.notEqual(v, "Rowena");
    assert.ok(["Godfrey", "Alaric"].includes(v));
  }
});
