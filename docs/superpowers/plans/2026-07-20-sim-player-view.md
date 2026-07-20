# Sim `--player` Perspective Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--player <who>` flag to the sim so the operator watches the game from a chosen participant's perspective (spectator/host/random/killer/healer/villager) in the visible browser, while the sim plays autonomously as before.

**Architecture:** `parseArgs` gains a validated `player` field. `run.ts` decides per-pick which context is headful: `spectator`/`host`/`random` are known at launch and created headful directly; `killer`/`healer`/`villager` start headless and, after roles are assigned, the matching bot migrates its identity (token in `localStorage`) into a new headful page via a new `Bot.migrateTo` method. A headless spectator always runs as the phase oracle for the round loop.

**Tech Stack:** TypeScript, Playwright (`chromium`), `tsx`, `node:test`.

## Global Constraints

- Default `--player` value is `spectator`; all existing invocations must behave identically.
- Auth/token localStorage key is `villagers:${code}` (from `lib/client.ts`) — copy verbatim.
- Tests run via `npm run sim:test` (`tsx --test sim/__tests__/*.test.ts`), using `node:test` + `node:assert/strict`.
- `--player healer` with `--no-healer` must error at parse time.
- Only one visible perspective at a time; the phase oracle is always a spectator context (headful only when `player === "spectator"`).

---

### Task 1: Parse and validate `--player`

**Files:**
- Modify: `sim/types.ts` (add `PlayerView` type and `player` field on `SimConfig`)
- Modify: `sim/args.ts:11-53` (parse + validate the flag)
- Test: `sim/__tests__/args.test.ts`

**Interfaces:**
- Produces: `type PlayerView = "spectator" | "host" | "random" | "killer" | "healer" | "villager"` exported from `sim/types.ts`; `SimConfig.player: PlayerView`.

- [ ] **Step 1: Write the failing tests**

Add to `sim/__tests__/args.test.ts`:

```typescript
test("defaults player to spectator", () => {
  assert.equal(parseArgs([]).player, "spectator");
});

test("parses --player values", () => {
  for (const p of ["spectator", "host", "random", "killer", "healer", "villager"] as const) {
    assert.equal(parseArgs(["--player", p]).player, p);
  }
});

test("rejects unknown --player value", () => {
  assert.throws(() => parseArgs(["--player", "wizard"]), /--player must be one of/);
});

test("--player healer with --no-healer errors", () => {
  assert.throws(() => parseArgs(["--player", "healer", "--no-healer"]), /healer/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run sim:test`
Expected: FAIL — `player` undefined / no such validation.

- [ ] **Step 3: Add the type**

In `sim/types.ts`, add above `SimConfig`:

```typescript
export type PlayerView =
  | "spectator" | "host" | "random" | "killer" | "healer" | "villager";
```

And add to the `SimConfig` interface:

```typescript
  player: PlayerView;
```

- [ ] **Step 4: Parse and validate in `sim/args.ts`**

Add the import at the top:

```typescript
import type { SimConfig, PlayerView } from "./types";
```

Add a valid-set constant below `DEFAULT_URL`:

```typescript
const PLAYER_VIEWS: PlayerView[] = [
  "spectator", "host", "random", "killer", "healer", "villager",
];
```

Add `let player: PlayerView = "spectator";` alongside the other `let` declarations, add a case to the switch:

```typescript
      case "--player": {
        const v = next() as PlayerView;
        if (!PLAYER_VIEWS.includes(v))
          throw new Error(`--player must be one of ${PLAYER_VIEWS.join(", ")}`);
        player = v;
        break;
      }
```

Add validation after the existing `maxPlayers` checks, before the `return`:

```typescript
  if (player === "healer" && !healer)
    throw new Error("--player healer requires a healer in the game (drop --no-healer)");
```

Add `player` to the returned object:

```typescript
  return { bots, killers, healer, ghostVotes, maxPlayers, url, player };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run sim:test`
Expected: PASS (all args tests, including the existing ones).

- [ ] **Step 6: Commit**

```bash
git add sim/types.ts sim/args.ts sim/__tests__/args.test.ts
git commit -m "sim: parse and validate --player flag"
```

---

### Task 2: `Bot.migrateTo` — move a headless bot into the visible browser

**Files:**
- Modify: `sim/bot.ts:13-29` (fields become mutable) and add `migrateTo` method
- Test: none (Playwright browser method; covered by manual run in Task 4)

**Interfaces:**
- Consumes: token stored at `localStorage["villagers:${code}"]` on the bot's current page.
- Produces: `async migrateTo(browser: Browser, code: string): Promise<void>` on `Bot` — opens a page in `browser` seeded with this bot's token, swaps `this.page`/`this.ctx` to it, closes the old context.

- [ ] **Step 1: Make `ctx` and `page` mutable**

In `sim/bot.ts`, change the constructor's `readonly page: Page` and `private readonly ctx: BrowserContext` so they can be reassigned. Because parameter properties can't drop `readonly` after the fact cleanly alongside the swap, convert them to plain mutable fields:

Replace the constructor signature block (lines ~18-24) so `ctx` and `page` are assigned in the body instead of being parameter properties:

```typescript
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
```

(Leave `Bot.create` unchanged — it still passes `ctx, page` positionally.)

- [ ] **Step 2: Add the `migrateTo` method**

Add to the `Bot` class (e.g. after `learnRole`):

```typescript
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

    const oldCtx = this.ctx;
    this.ctx = newCtx;
    this.page = newPage;
    await oldCtx.close().catch(() => {});
  }
```

Ensure `Browser` is imported — it already is (`import type { Browser, BrowserContext, Page } from "playwright";`).

- [ ] **Step 3: Type-check compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from `sim/bot.ts` (pre-existing app errors, if any, unrelated).

- [ ] **Step 4: Commit**

```bash
git add sim/bot.ts
git commit -m "sim: add Bot.migrateTo to surface a bot in a visible browser"
```

---

### Task 3: Wire `--player` into `run.ts` orchestration

**Files:**
- Modify: `sim/run.ts:39-138` (browser/context setup, host creation, post-roles migration)

**Interfaces:**
- Consumes: `config.player` (`PlayerView`), `Bot.migrateTo`, `Bot.role`, `Bot.isHost`.
- Produces: exactly one visible (headful) perspective per the pick; a headless spectator always present as the phase oracle.

- [ ] **Step 1: Choose the host's browser and the spectator's browser by pick**

Replace the browser/spectator setup (currently `sim/run.ts:43-49`) with:

```typescript
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
```

- [ ] **Step 2: Create the host in its chosen browser**

Change the host creation line (currently `sim/run.ts:53`) from `headless` to `hostBrowser`:

```typescript
    const host = await Bot.create(hostBrowser, names[0], true, config.url);
```

- [ ] **Step 3: Create the `random` pick's bot headful from launch**

The join loop currently creates every non-host bot in `headless` (`sim/run.ts:66-71`). Pick one non-host index up front to be visible when `player === "random"`. Add before the loop:

```typescript
    // For --player random, one non-host bot (indices 1..bots-1) is visible from
    // the start. Chosen now, before roles exist, so its role is whatever the
    // server later assigns.
    const randomIdx =
      config.player === "random"
        ? 1 + Math.floor(Math.random() * (config.bots - 1))
        : -1;
```

Change the loop body's `Bot.create` call to select the browser:

```typescript
    for (let i = 1; i < config.bots; i++) {
      const browser = i === randomIdx ? headful : headless;
      const b = await Bot.create(browser, names[i], false, config.url);
      await b.join(code);
      bots.push(b);
      console.log(`  ${names[i]} joined (${i + 1}/${config.bots})`);
    }
```

- [ ] **Step 4: Migrate a role-matching bot after roles are assigned**

After the roles are learned and `killerNames` is logged (currently `sim/run.ts:79-81`), add:

```typescript
    // Role-based picks aren't knowable until now: surface a matching bot in the
    // visible browser by migrating its token-bound identity into a headful page.
    if (config.player === "killer" || config.player === "healer" || config.player === "villager") {
      const pick = bots.find((b) => !b.isHost && b.role === config.player);
      if (!pick)
        throw new Error(`no bot was assigned the ${config.player} role to watch`);
      await pick.migrateTo(headful, code);
      console.log(`  Watching ${pick.name} (${config.player}).`);
    }
```

- [ ] **Step 5: Type-check compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `sim/run.ts`.

- [ ] **Step 6: Commit**

```bash
git add sim/run.ts
git commit -m "sim: wire --player into orchestration (headful pick + migration)"
```

---

### Task 4: Manual verification of each perspective

**Files:** none (verification only).

**Interfaces:** Consumes the full sim end-to-end.

- [ ] **Step 1: Default (spectator) unchanged**

Run: `npm run sim -- --url http://localhost:3000`
Expected: visible window shows the neutral spectator/observe view; game plays to a "The Village Prevails" / "The Killers Win" banner. (Press Enter at the two prompts.)

- [ ] **Step 2: Host perspective**

Run: `npm run sim -- --url http://localhost:3000 --player host`
Expected: the visible window is the host's screen, showing lobby then inline host controls ("Begin the Game", "Call the Trial", etc.); game completes.

- [ ] **Step 3: Random perspective**

Run: `npm run sim -- --url http://localhost:3000 --player random`
Expected: visible window is a plain player's screen (no host controls unless coincidentally… it never picks host); plays to completion.

- [ ] **Step 4: Killer / healer / villager**

Run each:
```
npm run sim -- --url http://localhost:3000 --player killer
npm run sim -- --url http://localhost:3000 --player healer
npm run sim -- --url http://localhost:3000 --player villager
```
Expected: after "Roles assigned", the console logs `Watching <name> (<role>).`, a visible window appears showing that player's view (a killer sees "With you:" fellow killers; healer/villager do not), and the game completes.

- [ ] **Step 5: Validation error path**

Run: `npm run sim -- --player healer --no-healer`
Expected: exits immediately with `--player healer requires a healer in the game`.

- [ ] **Step 6: Full test + lint gate**

Run: `npm run sim:test && npm run lint`
Expected: all pass.

---

## Self-Review Notes

- **Spec coverage:** flag+validation (Task 1), migration mechanism (Task 2), known-at-launch vs reopen split + headless phase oracle (Task 3), all six values + error path exercised (Task 4). ✓
- **Placeholders:** none — every code step shows full code.
- **Type consistency:** `PlayerView` defined in Task 1 and consumed by name in Tasks 1/3; `migrateTo(browser, code)` signature defined in Task 2 and called with `(headful, code)` in Task 3. ✓
