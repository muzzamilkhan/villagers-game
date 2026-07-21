# Sim Multiple Watched Player Views + Mobile Viewport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the sim watch multiple player perspectives at once (`--player killer,healer`), each in its own headful window at iPhone-Pro viewport size.

**Architecture:** Change `SimConfig.player` (single) → `players` (array). `parseArgs` comma-splits and validates. `Bot.create`/`migrateTo` gain a `mobile` flag that sets a 393×852 mobile context. `run.ts` assigns one headful window per watched value; non-spectator windows are mobile; the rest stay headless.

**Tech Stack:** TypeScript, Playwright, `tsx --test` (node test runner).

## Global Constraints

- iPhone 15/16 Pro viewport: **393×852**, `deviceScaleFactor: 3`, `isMobile: true`, `hasTouch: true`.
- `spectator` window keeps the default desktop viewport (no mobile flag).
- Valid `--player` values (`PLAYER_VIEWS`): `spectator, host, random, killer, healer, villager`.
- Only touch files under `sim/` — another agent owns the audio work.
- Run sim tests with: `npm run sim:test`.
- No game rule/phase/resolution change; game-flow Playwright tests unaffected.

---

### Task 1: Config type + parseArgs → players array

**Files:**
- Modify: `sim/types.ts:11` (`player: PlayerView` → `players: PlayerView[]`)
- Modify: `sim/args.ts` (parse comma lists, validate, return `players`)
- Test: `sim/__tests__/args.test.ts`

**Interfaces:**
- Produces: `SimConfig.players: PlayerView[]` — non-empty; defaults to `["spectator"]`. Order and duplicates from the CLI are preserved. Replaces the removed `SimConfig.player`.

- [ ] **Step 1: Update the failing tests**

In `sim/__tests__/args.test.ts`, replace the two existing player tests:

```typescript
// replace test("defaults player to spectator", ...)
test("defaults players to [spectator]", () => {
  assert.deepEqual(parseArgs([]).players, ["spectator"]);
});

// replace test("parses --player values", ...)
test("parses each single --player value", () => {
  for (const p of ["spectator", "host", "random", "killer", "healer", "villager"] as const) {
    assert.deepEqual(parseArgs(["--player", p]).players, [p]);
  }
});

test("comma-splits a --player list", () => {
  assert.deepEqual(parseArgs(["--player", "killer,healer"]).players, ["killer", "healer"]);
});

test("repeated --player flags accumulate", () => {
  assert.deepEqual(
    parseArgs(["--player", "killer", "--player", "healer"]).players,
    ["killer", "healer"],
  );
});

test("preserves duplicate --player values", () => {
  assert.deepEqual(parseArgs(["--player", "random,random"]).players, ["random", "random"]);
});

test("trims whitespace and drops empties in --player list", () => {
  assert.deepEqual(parseArgs(["--player", " killer , healer ,"]).players, ["killer", "healer"]);
});

test("rejects an unknown value inside a --player list", () => {
  assert.throws(() => parseArgs(["--player", "killer,wizard"]), /--player must be one of/);
});
```

Keep the existing `--player healer with --no-healer errors` test (it needs no change — it still throws).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run sim:test`
Expected: FAIL — `players` is undefined / `player` still returned.

- [ ] **Step 3: Update `sim/types.ts`**

Change line 11 inside `SimConfig`:

```typescript
  players: PlayerView[];
```

(Remove the old `player: PlayerView;` line. Leave the surrounding comment about `games` intact.)

- [ ] **Step 4: Update `sim/args.ts`**

Replace the `let player` declaration and the `--player` case, and the return.

Change the declaration (was `let player: PlayerView = "spectator";`):

```typescript
  const players: PlayerView[] = [];
```

Replace the `case "--player":` block:

```typescript
      case "--player": {
        const raw = next();
        const values = raw.split(",").map((s) => s.trim()).filter(Boolean);
        for (const v of values) {
          if (!PLAYER_VIEWS.includes(v as PlayerView))
            throw new Error(`--player must be one of ${PLAYER_VIEWS.join(", ")}`);
          players.push(v as PlayerView);
        }
        break;
      }
```

Replace the healer validation line (was `if (player === "healer" && !healer)`):

```typescript
  if (players.includes("healer") && !healer)
    throw new Error("--player healer requires a healer in the game (drop --no-healer)");
```

Add a default just before the healer check (after the `games` validation, before `return`):

```typescript
  if (players.length === 0) players.push("spectator");
```

Update the return object: replace `player` with `players`:

```typescript
  return { bots, killers, healer, ghostVotes, maxPlayers, url, players, games };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run sim:test`
Expected: PASS (all args tests green).

- [ ] **Step 6: Commit**

```bash
git add sim/types.ts sim/args.ts sim/__tests__/args.test.ts
git commit -m "Sim: accept comma-separated --player list (players array)"
```

---

### Task 2: Mobile viewport flag on Bot

**Files:**
- Modify: `sim/bot.ts` (`create`, `migrateTo`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `Bot.create(browser, name, isHost, url, mobile = false): Promise<Bot>`
  - `Bot.migrateTo(browser, code, mobile = false): Promise<void>`
  - Shared constant `MOBILE_CONTEXT` (context options object) used by both.

No dedicated unit test — this is Playwright context wiring exercised by the sim run. Verify by type-check + a live run in Task 4.

- [ ] **Step 1: Add the mobile context options**

At the top of `sim/bot.ts`, after the imports, add:

```typescript
// iPhone 15/16 Pro logical viewport. Watched non-spectator windows use this so
// the mobile-first UI renders the way players actually see it. Spectator keeps
// the default desktop viewport (it never passes mobile).
const MOBILE_CONTEXT = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
} as const;
```

- [ ] **Step 2: Thread `mobile` through `create`**

Replace the `create` method:

```typescript
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
```

- [ ] **Step 3: Thread `mobile` through `migrateTo`**

In `migrateTo`, change the signature and the `newContext` call. Signature:

```typescript
  async migrateTo(browser: Browser, code: string, mobile = false): Promise<void> {
```

The `newContext` line (was `const newCtx = await browser.newContext();`):

```typescript
    const newCtx = await browser.newContext(mobile ? MOBILE_CONTEXT : {});
```

Leave the rest of `migrateTo` (the `addInitScript` token copy, goto, `awaitSee`) unchanged.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors introduced). Callers still using 4 args compile because `mobile` defaults to `false`.

- [ ] **Step 5: Commit**

```bash
git add sim/bot.ts
git commit -m "Sim: add mobile (iPhone Pro) viewport flag to Bot"
```

---

### Task 3: run.ts — one headful window per watched value

**Files:**
- Modify: `sim/run.ts` (`main`, `playGame` migrate hook)

**Interfaces:**
- Consumes: `config.players: PlayerView[]`; `Bot.create(..., mobile)`; `Bot.migrateTo(..., mobile)`.
- Produces: no exported API change.

This task has no isolated unit test (it drives Playwright end-to-end). It is verified by the live run in Task 4.

- [ ] **Step 1: Spectator + host browser selection from `players`**

In `main`, replace the spectator browser line (was `const specBrowser = config.player === "spectator" ? headful : headless;`):

```typescript
  // The spectator is always our phase oracle. It is only the *visible* window
  // when the operator asked to watch the spectator; otherwise it runs headless.
  // Spectator always uses the default desktop viewport.
  const specBrowser = config.players.includes("spectator") ? headful : headless;
```

Replace the host browser line (was `const hostBrowser = config.player === "host" ? headful : headless;`):

```typescript
  // The host is visible from launch only when the operator asked to watch it.
  const watchHost = config.players.includes("host");
  const hostBrowser = watchHost ? headful : headless;
```

- [ ] **Step 2: Host bot gets a mobile window when watched**

Replace the host creation line (was `const host = await Bot.create(hostBrowser, names[0], true, config.url);`):

```typescript
    const host = await Bot.create(hostBrowser, names[0], true, config.url, watchHost);
```

- [ ] **Step 3: N distinct random indices**

Replace the `randomIdx` block (the `const randomIdx = config.player === "random" ? ... : -1;`):

```typescript
    // For each "random" in --player, pick one distinct non-host bot (indices
    // 1..bots-1) to surface in its own headful window. Chosen now, before roles
    // exist, so each bot's role is whatever the server later assigns.
    const randomCount = config.players.filter((p) => p === "random").length;
    const randomIdxs = new Set<number>();
    {
      const pool = Array.from({ length: config.bots - 1 }, (_, i) => i + 1);
      for (let n = 0; n < randomCount && pool.length > 0; n++) {
        const k = Math.floor(Math.random() * pool.length);
        randomIdxs.add(pool.splice(k, 1)[0]);
      }
    }
```

- [ ] **Step 4: Join loop uses the random set + mobile**

Replace the join loop body (the `for (let i = 1; i < config.bots; i++)` block):

```typescript
    for (let i = 1; i < config.bots; i++) {
      const watched = randomIdxs.has(i);
      const browser = watched ? headful : headless;
      const b = await Bot.create(browser, names[i], false, config.url, watched);
      await b.join(code);
      bots.push(b);
      console.log(`  ${names[i]} joined (${i + 1}/${config.bots})`);
    }
```

- [ ] **Step 5: Migrate one distinct bot per watched role value**

Replace the `migrateWatched` definition (the whole `const migrateWatched = ... : undefined;` block):

```typescript
    // Role-based watching (--player killer/healer/villager) surfaces a matching
    // bot per requested role value into its own headful mobile window once roles
    // exist. Each role value consumes a distinct matching bot. Only meaningful on
    // the first game; after that the chosen bots are already in headful windows.
    const roleValues = config.players.filter(
      (p) => p === "killer" || p === "healer" || p === "villager",
    );
    const migrateWatched =
      roleValues.length > 0
        ? async () => {
            const used = new Set<Bot>();
            for (const role of roleValues) {
              const pick = bots.find(
                (b) => !b.isHost && b.role === role && !used.has(b),
              );
              if (!pick)
                throw new Error(
                  `not enough bots with the ${role} role to watch (need ${
                    roleValues.filter((r) => r === role).length
                  })`,
                );
              used.add(pick);
              await pick.migrateTo(headful, code, true);
              console.log(`  Watching ${pick.name} (${role}).`);
            }
          }
        : undefined;
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. No remaining references to `config.player` (singular) anywhere.

- [ ] **Step 7: Verify no stale singular references**

Run: `grep -rn "config.player\b\|\.player\b" sim/`
Expected: only `.players` matches; no bare `config.player`.

- [ ] **Step 8: Commit**

```bash
git add sim/run.ts
git commit -m "Sim: render one mobile headful window per watched --player value"
```

---

### Task 4: Live smoke run

**Files:** none (verification only).

- [ ] **Step 1: Run against local dev with two watched views**

Dev is already running on :3000 (do not start it). Run:

```bash
npm run sim -- --url http://localhost:3000 --player killer,healer --bots 6
```

Expected: two headful browser windows open at phone size (one killer, one healer, both migrated once roles are assigned); the sim plays a full game to a game-over banner; console logs `Watching <name> (killer).` and `Watching <name> (healer).`; exits 0.

- [ ] **Step 2: Sanity-check a spectator+role combo**

```bash
npm run sim -- --url http://localhost:3000 --player spectator,killer --bots 6
```

Expected: a desktop-sized spectator window AND a phone-sized killer window, both headful; game completes.

- [ ] **Step 3: Confirm the full sim test suite still passes**

Run: `npm run sim:test`
Expected: PASS.

---

## Self-Review

**Spec coverage:**
- Comma-separated `--player` → Task 1. ✓
- One headful window per value → Task 3 (spectator/host/random/role paths). ✓
- iPhone 15/16 Pro viewport for non-spectator → Task 2 (`MOBILE_CONTEXT`) + Task 3 (mobile flags on host/random/migrate; spectator omitted). ✓
- `random` rule unchanged, N distinct picks → Task 3 Step 3. ✓
- Distinct bot per role value, clear shortfall error → Task 3 Step 5. ✓
- Tests → Task 1 Step 1. ✓

**Placeholder scan:** none — all steps show concrete code/commands.

**Type consistency:** `players: PlayerView[]` used consistently; `Bot.create(..., mobile = false)` and `migrateTo(..., mobile = false)` signatures match every call site in Task 3 (host: `watchHost`; random: `watched`; migrate: `true`). `MOBILE_CONTEXT` name consistent across Tasks 2–3.
