import type { Browser, BrowserContext, Page } from "playwright";
import type { SimConfig, Role } from "./types";
import { humanPause } from "./pacing";
import {
  awaitSee, clickTarget, revealRole, readLivingNames,
} from "./ui";
import { chooseKillTarget, chooseHealTarget, chooseVote } from "./strategy";

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

  static async create(browser: Browser, name: string, isHost: boolean, url: string): Promise<Bot> {
    const ctx = await browser.newContext();
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
  async migrateTo(browser: Browser, code: string): Promise<void> {
    const key = `villagers:${code}`;
    const token = await this.page.evaluate(
      (k) => window.localStorage.getItem(k),
      key,
    );
    if (!token) throw new Error(`no token found for ${this.name} to migrate`);

    const newCtx = await browser.newContext();
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

  async callTrial(): Promise<void> {
    const btn = this.page.getByRole("button", { name: "Call the Trial" });
    await btn.waitFor({ state: "visible" });
    await btn.click();
  }

  async lockVotes(): Promise<void> {
    await this.page.getByRole("button", { name: "Lock in the Votes" }).click();
  }

  async onward(): Promise<void> {
    await this.page.getByRole("button", { name: "Onward to Night" }).click();
  }

  async close(): Promise<void> {
    await this.ctx.close().catch(() => {});
  }
}
