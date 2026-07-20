import { chromium } from "playwright";
import readline from "node:readline";
import { parseArgs } from "./args";
import { assignNames } from "./names";
import { Bot, type RoundCtx } from "./bot";
import { bodyText, awaitSee } from "./ui";

// Wrap a wait so a timeout tells us WHERE we were and what the page showed,
// instead of a bare "Timeout 30000ms exceeded".
async function step(
  label: string,
  page: import("playwright").Page,
  texts: string[],
): Promise<void> {
  try {
    await awaitSee(page, texts);
  } catch (e) {
    const body = await bodyText(page).catch(() => "<no body>");
    console.error(
      `\n  [STALLED] "${label}" — never saw ${JSON.stringify(texts)}\n` +
        `  --- page body (first 800 chars) ---\n${body.slice(0, 800)}\n  ---`,
    );
    // Surface the label in the thrown message too, so the final one-line
    // "Sim failed: …" names the stalled step even when the dump scrolls off.
    throw new Error(`stalled at "${label}" (never saw ${JSON.stringify(texts)})`);
  }
}

// Confirmed live against app/play/[code]/page.tsx:771 — the only two
// game_over banners the GameOver component renders.
const GAME_OVER_TEXTS = ["The Village Prevails", "The Killers Win"];
const MAX_ROUNDS = 20;

function prompt(msg: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(msg, () => { rl.close(); resolve(); }));
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const names = assignNames(config.bots);

  // Name the target up front. The sim drives whatever `--url` points at
  // (default: prod), so a run against a mid-deploy prod can show stale UI —
  // logging the URL makes it obvious which server you're actually testing.
  console.log(`\n  Driving: ${config.url}`);

  const headless = await chromium.launch({ headless: true });
  const headful = await chromium.launch({ headless: false });
  const bots: Bot[] = [];

  // The spectator is always our phase oracle. It is only the *visible* window
  // when the operator asked to watch the spectator; otherwise it runs headless.
  const specBrowser = config.player === "spectator" ? headful : headless;
  const specCtx = await specBrowser.newContext();
  const specPage = await specCtx.newPage();

  // The host is visible from launch only when the operator asked to watch it.
  const hostBrowser = config.player === "host" ? headful : headless;

  try {
    // 1. Host creates.
    const host = await Bot.create(hostBrowser, names[0], true, config.url);
    bots.push(host);
    const code = await host.createGame(config);
    console.log(`\n  Game code: ${code}\n`);

    // 2. Spectator watches.
    await specPage.goto(config.url);
    await specPage.getByRole("button", { name: "Spectate" }).click();
    await specPage.getByPlaceholder("ABCD").fill(code);
    await specPage.getByRole("button", { name: "Spectate", exact: true }).click();
    await specPage.waitForURL("**/observe/**");

    // For --player random, one non-host bot (indices 1..bots-1) is visible from
    // the start. Chosen now, before roles exist, so its role is whatever the
    // server later assigns.
    const randomIdx =
      config.player === "random"
        ? 1 + Math.floor(Math.random() * (config.bots - 1))
        : -1;

    // 3. Remaining bots join, one at a time.
    for (let i = 1; i < config.bots; i++) {
      const browser = i === randomIdx ? headful : headless;
      const b = await Bot.create(browser, names[i], false, config.url);
      await b.join(code);
      bots.push(b);
      console.log(`  ${names[i]} joined (${i + 1}/${config.bots})`);
    }

    // 4. Pause for operator.
    console.log(`\n  All ${config.bots} bots in the lobby: ${names.join(", ")}`);
    await prompt("\n  ▶ Press Enter to start the game... ");

    // 5. Start + learn roles.
    await host.begin();
    await Promise.all(bots.map((b) => awaitSee(b.page, ["Night 1"]).then(() => b.learnRole())));
    const killerNames = bots.filter((b) => b.role === "killer").map((b) => b.name);
    console.log(`  Roles assigned. (${killerNames.length} killer(s))`);

    // Role-based picks aren't knowable until now: surface a matching bot in the
    // visible browser by migrating its token-bound identity into a headful page.
    if (config.player === "killer" || config.player === "healer" || config.player === "villager") {
      const pick = bots.find((b) => !b.isHost && b.role === config.player);
      if (!pick)
        throw new Error(`no bot was assigned the ${config.player} role to watch`);
      await pick.migrateTo(headful, code);
      console.log(`  Watching ${pick.name} (${config.player}).`);
    }

    // 6. Round loop.
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      // ---- NIGHT ----
      // Phase is detected from the SPECTATOR page, whose neutral game view is
      // the same no matter who is alive. The host bot is a mortal player: once
      // it is killed or voted out it becomes a ghost and its own screen shows
      // ghost text instead of player prompts — so we never wait on the host's
      // perspective. The host still HOLDS the advance controls after death
      // (the button is gated on isHost, not alive), so it keeps driving.
      const nightCtx = (b: Bot): RoundCtx => ({ killerNames: b.role === "killer" ? killerNames : [] });
      const alive = bots.filter((b) => b.alive);
      console.log(`  [round ${round}] night: ${alive.length} bots submitting…`);
      await Promise.all(alive.map((b) => b.doNightAction(nightCtx(b))));
      // Night auto-resolves server-side once all living players submit; the
      // spectator flips to the "Dawn" resolve screen (announcement shown
      // immediately, unlike the players' suspense-held card) — UNLESS the kill
      // ends the game, in which case it jumps straight to the game-over banner
      // (no "Dawn"). Accept either so the loop can break on the win below.
      // Observer Header still shows the "Dawn" phase label during resolve even
      // though the stage now renders composed Outcome text. Either that or a
      // game-over banner (a lethal night can end the game with no resolve beat).
      await step("night resolve", specPage, ["Dawn", ...GAME_OVER_TEXTS]);
      // Mark night deaths NOW, before the day vote — a ghost has no clickable
      // crest, so a bot the sim still thinks is alive would hang trying to vote.
      syncDeaths(bots, await announcement(specPage), round, "night");
      if (await ended(specPage)) break;
      await host.callTrial();

      // ---- DAY ----
      // Spectator shows "The Trial" / "Who shall be cast out?" during the vote.
      await step("open day vote", specPage, ["Who shall be cast out", ...GAME_OVER_TEXTS]);
      const voters = bots.filter((b) => b.alive || config.ghostVotes);
      console.log(`  [round ${round}] day: ${voters.length} voters…`);
      await Promise.all(voters.map((b) => b.doDayVote({ killerNames: b.role === "killer" ? killerNames : [] })));
      await host.lockVotes();
      // NOTE: deliberately "was cast out", not bare "cast out" — the day_vote
      // headline itself reads "Who shall be cast out?" (line 137), so a bare
      // "cast out" substring is already on the page before the vote even locks
      // and this step would resolve instantly against the wrong phase. Composed
      // castout_killer/castout_innocent text (lib/narration.tsx) always reads
      // "{name} was cast out — …", which "Who shall be cast out?" does not contain.
      await step("day result", specPage, ["was cast out", "No one was cast out", ...GAME_OVER_TEXTS]);
      // Mark the day's elimination (if any) before the next night.
      syncDeaths(bots, await announcement(specPage), round, "day");

      if (await ended(specPage)) break;
      await host.onward();
      // Accept the win banner here too: advancing can itself reveal an
      // end-state, and we'd rather break the loop than wait for a "Night
      // falls" that never comes.
      await step("next night", specPage, ["Night falls", ...GAME_OVER_TEXTS]);
      if (await ended(specPage)) break;
    }

    // 7. Result.
    const finalText = await bodyText(specPage);
    const winner = GAME_OVER_TEXTS.find((t) => finalText.includes(t)) ?? "(unknown)";
    console.log(`\n  Game over — ${winner}\n`);
    await prompt("  ▶ Press Enter to close the spectator and exit... ");
  } finally {
    for (const b of bots) await b.close();
    await specCtx.close().catch(() => {});
    await headless.close().catch(() => {});
    await headful.close().catch(() => {});
  }
}

async function ended(page: import("playwright").Page): Promise<boolean> {
  const t = await bodyText(page);
  return GAME_OVER_TEXTS.some((x) => t.includes(x));
}

// The spectator's headline text for the current beat: the night announcement
// during `resolve` ("{name} was slain in the night." / a quiet-dawn line) and
// the vote verdict during `day_result` ("{name} was cast out — …" / a no-one
// line). We read it from the spectator, not the players' screens, because the
// observer reveals it immediately while player screens hold a ~3.5s suspense
// card — reading a player page too early would miss the death.
async function announcement(specPage: import("playwright").Page): Promise<string> {
  return bodyText(specPage);
}

// Mark any bot the announcement names as dead. Death phrasing is third-person
// by name (lib/game.ts:164 "{name} was slain in the night."; lib/game.ts:218-219
// "{name} was cast out — …"). At most one player dies per resolution, but we
// scan all names defensively.
function syncDeaths(
  bots: Bot[],
  text: string,
  round: number,
  phase: "night" | "day",
): void {
  const lower = text.toLowerCase();
  const verb = phase === "night" ? "slain" : "cast out";
  for (const b of bots) {
    if (!b.alive) continue;
    // Composed outcome text keeps "{name} … {verb}" in reading order
    // (lib/narration.tsx). Match name followed by the verb, case-insensitive.
    const nameIdx = lower.indexOf(b.name.toLowerCase());
    if (nameIdx !== -1 && lower.indexOf(verb, nameIdx) !== -1) {
      b.alive = false;
      console.log(`  [round ${round}] ${phase}: ${b.name} died`);
    }
  }
}

main().catch((e) => {
  console.error("\n  Sim failed:", e?.message ?? e);
  process.exit(1);
});
