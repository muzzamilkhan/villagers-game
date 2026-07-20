import { test, expect, Browser, BrowserContext, Page } from "@playwright/test";
import path from "node:path";
import { LatencyRecorder } from "./stats";

/**
 * Concurrency & real-time latency harness.
 *
 * Spins up 10 real players (the host + 9 joiners) plus 1 passive observer, each
 * in its own isolated browser context with its own SSE stream — exactly like 11
 * phones pointed at the same game. It then drives a full two-round game and, for
 * every kind of broadcast (a player joining, the game starting, night actions
 * piling up, the dawn reveal, the vote tally climbing, an elimination, and the
 * final result), measures how long each of the *other* screens takes to reflect
 * the move. At the end it prints a min / avg / p50 / p95 / max breakdown per
 * event and writes a JSON + Markdown report under e2e/results/.
 *
 * The game is steered to a deterministic villagers win:
 *   Night 1 — killer and healer are both aimed at the same villager → no death.
 *   Day 1   — the village votes out an (innocent) villager → game continues.
 *   Night 2 — again no death.
 *   Day 2   — the village votes out the killer → villagers win.
 */

type Role = "villager" | "killer" | "healer";

interface Participant {
  name: string;
  page: Page;
  ctx: BrowserContext;
  role?: Role;
  alive: boolean;
  isHost: boolean;
}

interface Watcher {
  name: string;
  page: Page;
  texts: string[]; // any one of these appearing counts as "seen"
}

const recorder = new LatencyRecorder();

// ---------- low-level helpers ----------

// Resolve as soon as the page's visible text contains any of `texts`. Polls
// tightly so the measured latency reflects the SSE round-trip, not our sampling.
async function awaitSee(page: Page, texts: string[], timeout = 20_000) {
  await page.waitForFunction(
    (ts: string[]) => {
      const body = document.body?.innerText ?? "";
      return ts.some((t) => body.includes(t));
    },
    texts,
    { polling: 20, timeout }
  );
}

// Fire `action`, then time how long every watcher takes to reflect it.
// Watchers are awaited concurrently so we capture true fan-out latency.
async function measure(event: string, watchers: Watcher[], action: () => Promise<void>) {
  const t0 = Date.now();
  await action();
  await Promise.all(
    watchers.map(async (w) => {
      try {
        await awaitSee(w.page, w.texts);
      } catch (e) {
        const body = await w.page.evaluate(() => document.body?.innerText ?? "").catch(() => "<no body>");
        // eslint-disable-next-line no-console
        console.log(
          `[${event}] watcher "${w.name}" (${w.page.url()}) never saw ${JSON.stringify(
            w.texts
          )}\n--- body ---\n${body.slice(0, 600)}\n------------`
        );
        throw e;
      }
      recorder.record(event, { ms: Date.now() - t0, watcher: w.name });
    })
  );
}

// Click a target crest / vote button by the target's name. The name only ever
// appears in the button's primary (`text-lg`) label, never in the smaller voter
// list, so a substring match on the unique short name is unambiguous.
async function clickTarget(page: Page, name: string) {
  const btn = page
    .locator("button.crest", {
      has: page.locator("span.text-lg", { hasText: name }),
    })
    .first();
  await btn.click();
}

// ---------- navigation flows (mirror the real landing-page UI) ----------

async function createGame(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a Game" }).click();
  await page.getByPlaceholder("Sir Reginald").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL("**/play/**");
  const code = page.url().split("/play/")[1].replace(/\/.*$/, "").toUpperCase();
  return code;
}

async function joinPrep(page: Page, name: string, code: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Join a Game" }).click();
  await page.getByPlaceholder("Sir Reginald").fill(name);
  await page.getByPlaceholder("ABCD").fill(code);
}

async function joinCommit(page: Page) {
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await page.waitForURL("**/play/**");
}

async function observeGame(page: Page, code: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Spectate" }).click();
  await page.getByPlaceholder("ABCD").fill(code);
  await page.getByRole("button", { name: "Spectate", exact: true }).click();
  await page.waitForURL("**/observe/**");
}

// ---------- the scenario ----------

test("10 players + observer see every move in near real time", async ({ browser }) => {
  test.slow();

  const players: Participant[] = [];
  let observer!: Participant;
  const contexts: BrowserContext[] = [];

  const newCtx = async () => {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    return ctx;
  };

  // The observer's screen words phases differently from a player's, so watcher
  // lists carry per-screen text. Night is the one reused often.
  const observerNight = ["Night falls"];

  try {
    // --- host creates the room ---
    const hostCtx = await newCtx();
    const hostPage = await hostCtx.newPage();
    const code = await createGame(hostPage, "Host");
    const host: Participant = {
      name: "Host",
      page: hostPage,
      ctx: hostCtx,
      alive: true,
      isHost: true,
    };
    players.push(host);
    expect(code).toMatch(/^[A-Z0-9]{4}$/);

    // --- observer starts watching the lobby ---
    const obsCtx = await newCtx();
    const obsPage = await obsCtx.newPage();
    await observeGame(obsPage, code);
    observer = { name: "Observer", page: obsPage, ctx: obsCtx, alive: true, isHost: false };
    await awaitSee(observer.page, ["Host"]); // observer shows the lobby with the host

    // --- 9 more players join, one at a time, timing how fast everyone sees them ---
    for (let k = 1; k <= 9; k++) {
      const name = `P${k}`;
      const ctx = await newCtx();
      const page = await ctx.newPage();
      const p: Participant = { name, page, ctx, alive: true, isHost: false };

      await joinPrep(page, name, code);

      const watchers: Watcher[] = [
        ...players.map((w) => ({ name: w.name, page: w.page, texts: [name] })),
        { name: observer.name, page: observer.page, texts: [name] },
      ];
      await measure("player_join", watchers, async () => {
        await joinCommit(page);
      });

      players.push(p);
    }

    expect(players).toHaveLength(10);

    // Watcher-list builders reused across phases.
    const alivePlayers = () => players.filter((p) => p.alive);
    const playerWatchers = (playerTexts: string[], observerTexts: string[], aliveOnly = true): Watcher[] => [
      ...(aliveOnly ? alivePlayers() : players).map((p) => ({
        name: p.name,
        page: p.page,
        texts: playerTexts,
      })),
      { name: observer.name, page: observer.page, texts: observerTexts },
    ];

    // --- host starts the game; everyone should flip to night ---
    await measure(
      "game_start",
      playerWatchers(["Night 1"], observerNight, false),
      async () => {
        await host.page.getByRole("button", { name: "Begin the Game" }).click();
      }
    );

    // --- learn every role (each player reveals their own card) ---
    for (const p of players) {
      await p.page.getByText("Tap to reveal your role").click();
      const title = (await p.page.locator("p.text-3xl").first().innerText())
        .trim()
        .toLowerCase();
      p.role = title as Role;
    }
    const killer = players.find((p) => p.role === "killer");
    const healer = players.find((p) => p.role === "healer");
    expect(killer, "exactly one killer should be assigned").toBeTruthy();
    expect(healer, "a healer should be assigned").toBeTruthy();
    const nonHostVillagers = players.filter((p) => p.role === "villager" && !p.isHost);
    expect(nonHostVillagers.length).toBeGreaterThanOrEqual(2);

    // Drive one night: every living player submits, killer & healer aimed at the
    // same villager so no one dies. The victim can't target itself, so it aims
    // at the host instead — a harmless villager action.
    const runNight = async (round: number, victim: Participant) => {
      const denom = alivePlayers().length;
      const target = (p: Participant) => (p === victim ? host.name : victim.name);
      const nonHostAlive = alivePlayers().filter((p) => !p.isHost);

      // Non-host players first, so the counter climbs 1..(denom-1) cleanly.
      for (let i = 0; i < nonHostAlive.length; i++) {
        const actor = nonHostAlive[i];
        const n = i + 1;
        const watchers: Watcher[] = [
          { name: host.name, page: host.page, texts: [`${n} / ${denom}`] },
          { name: observer.name, page: observer.page, texts: [`${n} of ${denom}`] },
        ];
        await measure("night_action_progress", watchers, async () => {
          await clickTarget(actor.page, target(actor));
        });
      }

      // Host submits last → the night auto-resolves. Players see the dawn hold;
      // the observer sees the announcement immediately.
      await measure(
        "night_resolve",
        playerWatchers(["Dawn breaks over the village"], ["kept them alive"]),
        async () => {
          await clickTarget(host.page, target(host));
        }
      );
      void round; // (round is documented context; heal-repeat safety handled by caller)
    };

    // Drive one day vote toward `eliminated`. Everyone votes the target except
    // the target (can't vote itself) which votes the host — keeping a clean
    // plurality with no tie.
    const runDayVote = async (eliminated: Participant, fallbackName: string, eventForResolve: string, resolveWatchers: Watcher[]) => {
      // Open the trial. The host's "Call the Trial" button only appears after the
      // deliberate ~3.5s dawn-reveal hold on their own screen, so wait for it
      // *before* starting the timer — otherwise we'd measure that UX delay
      // instead of the actual broadcast latency.
      const callTrial = host.page.getByRole("button", { name: "Call the Trial" });
      await callTrial.waitFor({ state: "visible" });
      await measure(
        "night_to_day",
        playerWatchers(["Vote for who you suspect"], ["Who shall be cast out"]),
        async () => {
          await callTrial.click();
        }
      );

      const denom = alivePlayers().length;
      const target = (p: Participant) => (p === eliminated ? fallbackName : eliminated.name);
      const nonHostAlive = alivePlayers().filter((p) => !p.isHost);

      for (let i = 0; i < nonHostAlive.length; i++) {
        const actor = nonHostAlive[i];
        const n = i + 1;
        const watchers: Watcher[] = [
          { name: host.name, page: host.page, texts: [`${n} / ${denom}`] },
          { name: observer.name, page: observer.page, texts: [`${n} of ${denom}`] },
        ];
        await measure("vote_tally_progress", watchers, async () => {
          await clickTarget(actor.page, target(actor));
        });
      }
      // host casts the final vote (no auto-resolve on votes)
      await clickTarget(host.page, target(host));
      await awaitSee(host.page, [`${denom} / ${denom}`]);

      // host locks in → resolution broadcast
      await measure(eventForResolve, resolveWatchers, async () => {
        await host.page.getByRole("button", { name: "Lock in the Votes" }).click();
      });
    };

    // ===== Round 1 =====
    const victim1 = nonHostVillagers[0];
    await runNight(1, victim1);

    const dayEliminated = nonHostVillagers.find((p) => p !== victim1)!;
    // fallback vote target for the eliminated player: any alive player that
    // isn't them (the host works, since the eliminated one is never the host).
    await runDayVote(
      dayEliminated,
      host.name,
      "day_result",
      playerWatchers(["was cast out"], ["was cast out"], false)
    );
    dayEliminated.alive = false;

    // advance to night 2
    await measure(
      "day_to_night",
      playerWatchers(["Night 2"], observerNight),
      async () => {
        await host.page.getByRole("button", { name: "Onward to Night" }).click();
      }
    );

    // ===== Round 2 =====
    // Heal-repeat rule: the healer can't shield victim1 two nights running, so
    // pick a different living villager as the (again-saved) victim.
    const victim2 =
      nonHostVillagers.find((p) => p.alive && p !== victim1 && p !== dayEliminated) ??
      alivePlayers().find((p) => !p.isHost && p !== killer && p !== healer)!;
    await runNight(2, victim2);

    // Day 2 → vote out the killer → villagers win.
    const fallbackForKiller =
      alivePlayers().find((p) => p !== killer)?.name ?? host.name;
    await runDayVote(
      killer!,
      fallbackForKiller,
      "game_over",
      playerWatchers(["The Village Prevails"], ["The Village Prevails"], false)
    );

    // --- assert the game actually ended the way we steered it ---
    await expect(host.page.getByText("The Village Prevails")).toBeVisible();
    await expect(observer.page.getByText("The Village Prevails")).toBeVisible();

    // Sanity: every event type produced samples.
    const summary = recorder.summarize();
    const seen = new Set(summary.map((s) => s.event));
    for (const ev of [
      "player_join",
      "game_start",
      "night_action_progress",
      "night_resolve",
      "night_to_day",
      "vote_tally_progress",
      "day_result",
      "day_to_night",
      "game_over",
    ]) {
      expect(seen.has(ev), `expected samples for "${ev}"`).toBeTruthy();
    }
  } finally {
    // Always emit the breakdown, even if an assertion above failed midway.
    const table = recorder.renderTable();
    // eslint-disable-next-line no-console
    console.log(
      "\n=== Villagers real-time propagation latency (10 players + observer) ===\n" +
        table +
        "\n"
    );
    const jsonPath = path.join(__dirname, "results", "latency-report.json");
    const mdPath = path.join(__dirname, "results", "latency-report.md");
    recorder.writeReport(jsonPath, mdPath);
    // eslint-disable-next-line no-console
    console.log(`Wrote report to:\n  ${jsonPath}\n  ${mdPath}\n`);

    for (const ctx of contexts) {
      await ctx.close().catch(() => {});
    }
  }
});
