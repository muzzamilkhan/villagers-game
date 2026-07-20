import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../args";

test("defaults when no flags", () => {
  const c = parseArgs([]);
  assert.equal(c.bots, 8);
  assert.equal(c.killers, 1);
  assert.equal(c.healer, true);
  assert.equal(c.ghostVotes, false);
  assert.equal(c.maxPlayers, 8);
  assert.equal(c.url, "https://villagers-game-pied.vercel.app/");
});

test("parses flags", () => {
  const c = parseArgs(["--bots", "6", "--killers", "2", "--no-healer", "--ghost-votes"]);
  assert.equal(c.bots, 6);
  assert.equal(c.killers, 2);
  assert.equal(c.healer, false);
  assert.equal(c.ghostVotes, true);
  assert.equal(c.maxPlayers, 6);
});

test("maxPlayers floors at bots and at killer minimum", () => {
  // 2 killers → minPlayersToStart 6; bots 5 is below min → error
  assert.throws(() => parseArgs(["--killers", "2", "--bots", "5"]), /at least 6/);
});

test("bots cannot exceed 10", () => {
  assert.throws(() => parseArgs(["--bots", "11"]), /at most 10/);
});

test("explicit --max-players must be >= bots", () => {
  assert.throws(() => parseArgs(["--bots", "8", "--max-players", "7"]), /max-players/);
});

test("--url overrides target", () => {
  assert.equal(parseArgs(["--url", "http://localhost:3000"]).url, "http://localhost:3000");
});
