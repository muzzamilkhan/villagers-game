# Sim: multiple watched player views + mobile viewport

Date: 2026-07-21

## Goal

Let the sim watch **more than one** player perspective at once, and render each
watched player's window at iPhone-Pro size so the mobile-first UI looks the way
players actually see it.

Concretely:

- `--player` accepts a comma-separated list (e.g. `--player killer,healer`).
- Every value in the list gets **its own headful browser window** (today's
  behavior for a single value, extended to N values).
- All non-`spectator` watched windows use an iPhone 15/16 Pro viewport
  (393×852). The `spectator` window keeps the default desktop viewport.
- The `random` selection rule is unchanged per value; a value repeated N times
  (`random,random`) surfaces N **distinct** random non-host bots.

## Non-goals

- No change to game rules, phases, resolution, or narration.
- No change to how bots decide actions/votes.
- No new device emulation beyond viewport/mobile flags (no geolocation, etc.).

## Config change

`SimConfig.player: PlayerView` → **`players: PlayerView[]`**.

`parseArgs`:

- Each `--player` occurrence is split on `,`; values are trimmed and empties
  dropped. Repeated `--player` flags accumulate (`--player killer --player healer`
  ≡ `--player killer,healer`).
- Each value is validated against `PLAYER_VIEWS`; an unknown value throws the
  existing `--player must be one of …` error.
- Default (no `--player`) is `["spectator"]`.
- `healer` value present while `--no-healer` set → existing error (checked with
  `players.includes("healer")`).

## Viewport (`bot.ts`)

- iPhone 15/16 Pro logical size: **393×852**, `deviceScaleFactor: 3`,
  `isMobile: true`, `hasTouch: true`.
- `Bot.create(browser, name, isHost, url, mobile = false)` — when `mobile`,
  create the context with the mobile viewport options; otherwise unchanged.
- `Bot.migrateTo(browser, code, mobile = false)` — same: the migrated context
  gets the mobile viewport when `mobile` is set.
- The spectator page is created directly in `run.ts` (not via `Bot`) and keeps
  its default desktop viewport.

## Window assignment (`run.ts`)

The single shared `headful` browser hosts one context (window) per watched
value; `headless` serves every other bot. Mapping per value:

- `spectator` → spectator page runs in `headful` (desktop viewport).
- `host` → host bot created in `headful` with `mobile = true`.
- `random` → a non-host bot index chosen at random (current rule), created in
  `headful` + mobile. N `random` values → N distinct indices, no repeats.
- `killer` / `healer` / `villager` → after roles are assigned (game 1), migrate
  a matching bot into a `headful` + mobile window. Each role value consumes a
  **distinct** matching bot; if fewer bots hold that role than requested, throw
  a clear error naming the role and the shortfall.

Generalizations of today's single-valued state:

- `randomIdx: number` → `randomIdxs: Set<number>` (distinct random picks).
- `migrateWatched` iterates the role-values in `players`, picking a distinct
  unused bot per value. Only fires on game 1 (roles reassign each game).
- `specBrowser` is headful iff `players.includes("spectator")`.
- `hostBrowser` is headful iff `players.includes("host")`.

## Tests

Extend `sim/__tests__/args.test.ts`:

- Default → `players: ["spectator"]`.
- `--player killer,healer` → `["killer","healer"]`.
- Repeated flags accumulate.
- Duplicates preserved (`random,random` → two entries).
- Unknown value in a list throws.
- `healer` in list with `--no-healer` throws.

Existing single-value `--player` tests update to assert against `players`.

No Playwright/game-flow rule changed, so the game-flow Playwright tests and the
core sim loop stay in sync (viewport is presentation-only).
