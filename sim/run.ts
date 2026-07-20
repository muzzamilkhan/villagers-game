import { chromium } from "playwright";
import readline from "node:readline";
import { parseArgs } from "./args.ts";
import { assignNames } from "./names.ts";
import { Bot, type RoundCtx } from "./bot.ts";
import { bodyText, awaitSee } from "./ui.ts";

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

  const headless = await chromium.launch({ headless: true });
  const headful = await chromium.launch({ headless: false });
  const bots: Bot[] = [];

  // spectator context lives on the headful (visible) browser
  const specCtx = await headful.newContext();
  const specPage = await specCtx.newPage();

  try {
    // 1. Host creates.
    const host = await Bot.create(headless, names[0], true, config.url);
    bots.push(host);
    const code = await host.createGame(config);
    console.log(`\n  Game code: ${code}\n`);

    // 2. Spectator watches.
    await specPage.goto(config.url);
    await specPage.getByRole("button", { name: "Spectate" }).click();
    await specPage.getByPlaceholder("ABCD").fill(code);
    await specPage.getByRole("button", { name: "Spectate", exact: true }).click();
    await specPage.waitForURL("**/observe/**");

    // 3. Remaining bots join, one at a time.
    for (let i = 1; i < config.bots; i++) {
      const b = await Bot.create(headless, names[i], false, config.url);
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

    // 6. Round loop.
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      // ---- NIGHT ----
      const nightCtx = (b: Bot): RoundCtx => ({ killerNames: b.role === "killer" ? killerNames : [] });
      await Promise.all(bots.filter((b) => b.alive).map((b) => b.doNightAction(nightCtx(b))));
      // Night auto-resolves once all living players submit. The resolve screen
      // holds a suspense card for ~3.5s ("Dawn breaks over the village…")
      // before revealing the announcement text; either the reveal (host sees
      // "Call the Trial") or, as a fallback in case of timing weirdness, the
      // announcement text itself is enough to know we've moved past night.
      await awaitSee(host.page, [
        "Dawn breaks over the village",
        "Call the Trial",
        "was slain in the night",
        "No one was harmed",
      ]);
      if (await ended(host.page)) break;
      await host.callTrial();

      // ---- DAY ----
      await awaitSee(host.page, ["Vote for who you suspect"]);
      const voters = bots.filter((b) => b.alive || config.ghostVotes);
      await Promise.all(voters.map((b) => b.doDayVote({ killerNames: b.role === "killer" ? killerNames : [] })));
      await host.lockVotes();
      await awaitSee(host.page, ["was cast out", "No one was cast out", ...GAME_OVER_TEXTS]);

      // sync alive-state from each bot's own page.
      await syncAlive(bots);

      if (await ended(host.page)) break;
      await host.onward();
      await awaitSee(host.page, [`Night ${round + 1}`]);
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

// There is no "you were slain" text anywhere in the app — death announcements
// are third-person by name: night deaths read `"{name} was slain in the
// night."` (lib/game.ts:164) and day eliminations read `"{name} was cast out
// — and was indeed a killer!"` / `"{name} was cast out — but was innocent."`
// (lib/game.ts:218-219). So each still-alive bot marks itself dead by
// checking whether ITS OWN name appears in that phrasing on its own screen.
async function syncAlive(bots: Bot[]): Promise<void> {
  await Promise.all(
    bots.map(async (b) => {
      if (!b.alive) return;
      const t = await bodyText(b.page);
      if (t.includes(`${b.name} was slain`) || t.includes(`${b.name} was cast out`)) {
        b.alive = false;
      }
    }),
  );
}

main().catch((e) => {
  console.error("\n  Sim failed:", e?.message ?? e);
  process.exit(1);
});
