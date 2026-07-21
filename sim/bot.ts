import type { Browser, BrowserContext, Page } from "playwright";
import type { SimConfig, Role } from "./types";
import { humanPause, sleep } from "./pacing";
import {
  awaitSee, clickTarget, revealRole, readLivingNames,
} from "./ui";
import { chooseKillTarget, chooseHealTarget, chooseVote } from "./strategy";

// Watched non-spectator windows emulate touch so the mobile-first UI behaves the
// way players' phones do. We deliberately DON'T pin a fixed `viewport`/`isMobile`/
// `deviceScaleFactor` here: those lock the page to an unresizable size in Chromium.
// Instead the window OPENS at iPhone-Pro size via the headful browser's
// `--window-size` launch arg (see MOBILE_WINDOW in run.ts), and `viewport: null`
// lets the page track the real window — so the operator can freely resize it.
// Spectator keeps the default desktop context (it never passes mobile).
const MOBILE_CONTEXT = {
  viewport: null,
  hasTouch: true,
} as const;

export interface RoundCtx {
  killerNames: string[]; // populated for killers only
}

export class Bot {
  role?: Role;
  alive = true;
  private lastHeal?: string;

  private ctx: BrowserContext;
  page: Page;

  private constructor(
    readonly name: string,
    readonly isHost: boolean,
    ctx: BrowserContext,
    page: Page,
    private readonly url: string,
  ) {
    this.ctx = ctx;
    this.page = page;
  }

  static async create(
    browser: Browser,
    name: string,
    isHost: boolean,
    url: string,
    mobile = false,
  ): Promise<Bot> {
    const ctx = await browser.newContext(mobile ? MOBILE_CONTEXT : {});
    const page = await ctx.newPage();
    return new Bot(name, isHost, ctx, page, url);
  }

  async createGame(config: SimConfig): Promise<string> {
    const page = this.page;
    await page.goto(this.url);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByPlaceholder("Sir Reginald").fill(this.name);

    // Settings. Killers: click the 1/2 button. Healer/ghost toggles read their
    // current Yes/No label and click only if a change is needed.
    if (config.killers === 2) {
      await page.locator("button", { hasText: /^2$/ }).first().click();
    }
    const setToggle = async (label: string, want: boolean) => {
      const btn = page.locator("button", { hasText: /^(Yes|No)$/ }).nth(label === "healer" ? 0 : 1);
      const cur = (await btn.innerText()).trim() === "Yes";
      if (cur !== want) await btn.click();
    };
    await setToggle("healer", config.healer);
    await setToggle("ghost", config.ghostVotes);

    // Max players: the range input.
    await page.locator("input[type='range']").fill(String(config.maxPlayers));

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForURL("**/play/**");
    return page.url().split("/play/")[1].replace(/\/.*$/, "").toUpperCase();
  }

  async join(code: string): Promise<void> {
    const page = this.page;
    await page.goto(this.url);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await page.getByPlaceholder("Sir Reginald").fill(this.name);
    await page.getByPlaceholder("ABCD").fill(code);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await page.waitForURL("**/play/**");
  }

  async begin(): Promise<void> {
    await this.page.getByRole("button", { name: "Begin the Game" }).click();
  }

  async learnRole(): Promise<void> {
    this.role = await revealRole(this.page);
  }

  // Move this bot's identity into another browser (used to surface a headless
  // bot in the visible headful window). Auth is by token in localStorage under
  // `villagers:${code}` (lib/client.ts); we copy it into a fresh context so the
  // server restores the same player + role, then drive that visible page.
  async migrateTo(browser: Browser, code: string, mobile = false): Promise<void> {
    const key = `villagers:${code}`;
    const token = await this.page.evaluate(
      (k) => window.localStorage.getItem(k),
      key,
    );
    if (!token) throw new Error(`no token found for ${this.name} to migrate`);

    const newCtx = await browser.newContext(mobile ? MOBILE_CONTEXT : {});
    await newCtx.addInitScript(
      ([k, t]) => window.localStorage.setItem(k, t),
      [key, token] as const,
    );
    const newPage = await newCtx.newPage();
    const base = this.url.endsWith("/") ? this.url : `${this.url}/`;
    await newPage.goto(`${base}play/${code}`);

    // goto resolves on `load`, before the SSE stream has restored this player's
    // filtered state and rendered the night screen. Wait for the night header
    // ("Night {round}") so the round loop doesn't drive an unhydrated page —
    // readLivingNames does an unwaited evaluate and would otherwise see [].
    await awaitSee(newPage, ["Night "]);

    const oldCtx = this.ctx;
    this.ctx = newCtx;
    this.page = newPage;
    await oldCtx.close().catch(() => {});
  }

  async doNightAction(ctx: RoundCtx): Promise<void> {
    if (!this.alive) return;
    await humanPause();
    const living = await readLivingNames(this.page);
    let target: string;
    if (this.role === "killer") {
      const nonKillers = living.filter((n) => !ctx.killerNames.includes(n));
      target = chooseKillTarget(nonKillers.length ? nonKillers : living.filter((n) => n !== this.name));
    } else if (this.role === "healer") {
      target = chooseHealTarget(living, this.name, this.lastHeal);
      this.lastHeal = target;
    } else {
      // villager: harmless pick, any living player that isn't self
      const others = living.filter((n) => n !== this.name);
      target = others[Math.floor(Math.random() * others.length)] ?? living[0];
    }
    await clickTarget(this.page, target);
  }

  async doDayVote(ctx: RoundCtx): Promise<void> {
    if (!this.alive) return; // ghost-vote handling: caller decides eligibility
    await humanPause();
    const living = await readLivingNames(this.page);
    const target = chooseVote(living, this.name, ctx.killerNames, this.role === "killer");
    await clickTarget(this.page, target);
  }

  // Host advances past the night reveal into the day. `waitMs` is a deliberate
  // sim-only pause before the click, so the beat is watchable — it doesn't
  // change the game, only how patiently the bot drives it.
  async callTrial(waitMs = 0): Promise<void> {
    const btn = this.page.getByRole("button", { name: "Continue", exact: true });
    await btn.waitFor({ state: "visible" });
    if (waitMs > 0) await sleep(waitMs);
    await btn.click();
  }

  // Host locks the day votes. `waitMs` pauses (sim-only) before locking so the
  // vote tally is watchable first.
  async lockVotes(waitMs = 0): Promise<void> {
    const btn = this.page.getByRole("button", { name: "Lock in the Votes" });
    await btn.waitFor({ state: "visible" });
    if (waitMs > 0) await sleep(waitMs);
    await btn.click();
  }

  // Host advances past the day result into the next night. `waitMs` is a
  // sim-only pause before the click, so the verdict is watchable.
  async onward(waitMs = 0): Promise<void> {
    const btn = this.page.getByRole("button", { name: "Continue", exact: true });
    await btn.waitFor({ state: "visible" });
    if (waitMs > 0) await sleep(waitMs);
    await btn.click();
  }

  // Host-only, from the game-over screen: start a fresh game with the same code,
  // players, and settings. The room drops back to the lobby for everyone.
  async newGame(): Promise<void> {
    await this.page.getByRole("button", { name: "New game", exact: true }).click();
  }

  // Host-only, from the game-over screen: end the game for everyone. Wipes the
  // room from Redis; every player's stream then reports the room is gone.
  //
  // The game-over screen's own "End game" is the last such button in the DOM —
  // older builds also render a top-bar "End game" in every phase, so scope to
  // the last match to avoid a strict-mode clash on those.
  async endGame(): Promise<void> {
    await this.page.getByRole("button", { name: "End game", exact: true }).last().click();
  }

  // Reset per-game bot bookkeeping when a new game begins. Roles are re-assigned
  // server-side, so we clear the old role and revive the bot; the round loop
  // re-learns the role after the host starts.
  resetForNewGame(): void {
    this.role = undefined;
    this.alive = true;
    this.lastHeal = undefined;
  }

  async close(): Promise<void> {
    await this.ctx.close().catch(() => {});
  }
}
