import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bedForPhase,
  stingForPhase,
  planTransition,
  BED_FILES,
  STING_FILES,
  ALL_AUDIO_FILES,
} from "../sound-plan";

test("bedForPhase maps only night/day to beds", () => {
  assert.equal(bedForPhase("night_action"), "night");
  assert.equal(bedForPhase("day_vote"), "day");
  assert.equal(bedForPhase("resolve"), null);
  assert.equal(bedForPhase("day_result"), null);
  assert.equal(bedForPhase("game_over"), null);
  assert.equal(bedForPhase("lobby"), null);
});

test("stingForPhase covers every audible phase", () => {
  assert.equal(stingForPhase("night_action"), "night");
  assert.equal(stingForPhase("resolve"), "dawn");
  assert.equal(stingForPhase("day_vote"), "day");
  assert.equal(stingForPhase("day_result"), "verdict");
  assert.equal(stingForPhase("lobby"), null);
});

test("game_over sting depends on winner", () => {
  assert.equal(stingForPhase("game_over", "killers"), "loss");
  assert.equal(stingForPhase("game_over", "villagers"), "win");
  assert.equal(stingForPhase("game_over", undefined), "win");
});

test("planTransition crossfades when the bed changes", () => {
  const t = planTransition("day_vote", undefined, "night");
  assert.equal(t.bed, "day");
  assert.equal(t.bedChanged, true);
  assert.equal(t.sting, "day");
});

test("planTransition leaves the bed alone when it is unchanged", () => {
  const t = planTransition("night_action", undefined, "night");
  assert.equal(t.bed, "night");
  assert.equal(t.bedChanged, false);
  assert.equal(t.sting, "night");
});

test("planTransition fades to silence on a bedless phase", () => {
  const t = planTransition("resolve", undefined, "night");
  assert.equal(t.bed, null);
  assert.equal(t.bedChanged, true);
  assert.equal(t.sting, "dawn");
});

test("planTransition on a bedless phase with no current bed does not change the bed", () => {
  const t = planTransition("day_result", undefined, null);
  assert.equal(t.bed, null);
  assert.equal(t.bedChanged, false);
  assert.equal(t.sting, "verdict");
});

test("file maps and preload list are consistent", () => {
  assert.equal(BED_FILES.night, "/audio/bed-night.ogg");
  assert.equal(STING_FILES.verdict, "/audio/sting-verdict.ogg");
  assert.equal(ALL_AUDIO_FILES.length, 8);
  assert.ok(ALL_AUDIO_FILES.includes("/audio/bed-day.ogg"));
  assert.ok(ALL_AUDIO_FILES.includes("/audio/sting-loss.ogg"));
});
