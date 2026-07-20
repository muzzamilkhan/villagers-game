# Villagers Sim — `--player` Perspective Flag — Design

**Date:** 2026-07-20
**Status:** Approved, ready for implementation planning

## Goal

Add a `--player <who>` flag to the sim so the operator can watch the game from a
chosen participant's perspective in the visible (headful) browser, instead of
only the neutral spectator view. The sim still plays autonomously exactly as it
does today — the flag only changes *whose screen* is shown to the operator.

## The flag

`--player <who>`, where `<who>` is one of:

| Value | Visible window shows | Default |
|-------|----------------------|---------|
| `spectator` | neutral spectator/observer view (current behavior) | ✅ |
| `host` | the host bot's screen, including inline host controls | |
| `random` | a randomly chosen **non-host player bot** (any role) | |
| `killer` | a bot that was assigned the killer role | |
| `healer` | a bot that was assigned the healer role | |
| `villager` | a bot that was assigned the plain villager role | |

Default is `spectator`, so existing invocations are unchanged.

Parsed in `sim/args.ts` and stored on `SimConfig` as `player: PlayerView`.

### Validation (in `parseArgs`)

- Reject any `<who>` not in the set above.
- `--player healer` combined with `--no-healer` → error (no healer will exist).
- `killer` and `villager` are always satisfiable given the enforced minimum
  player counts, so no extra validation is needed for them beyond role match at
  runtime.

## Two categories: "known at launch" vs "reopen after roles"

Roles are assigned **randomly server-side** when the game starts
(`assignRoles` in `lib/game.ts`), so the sim cannot know before start which bot
will hold a given role. This splits the picks:

### Known at launch — visible from the start

- **`spectator`**: unchanged. The spectator page runs in the headful browser.
- **`host`**: the host bot is created against the **headful** browser instead of
  headless. The operator sees the lobby onward from the host's screen.
- **`random`**: one randomly chosen bot from the **non-host player bots**
  (excludes host and spectator) is created against the **headful** browser.
  Chosen at launch, before roles exist, so its eventual role is whatever the
  server assigns.

For these, no reopening happens — the chosen context is headful from creation.

### Not known at launch — reopen after roles assigned

- **`killer` / `healer` / `villager`**: all bots start **headless**. After the
  game starts and every bot has run `learnRole()`, the sim picks a bot whose
  `role` matches the request and **migrates** it to the headful browser (see
  below). Play then continues on the visible page.

If somehow no bot matches (should be prevented by validation), fail loudly with
a clear message naming the requested role.

## The migration mechanism (role-based picks)

Auth is by token stored in the browser `localStorage` under the key
`villagers:${code}` (see `lib/client.ts`). To move a headless bot into the
visible browser without disturbing server state:

1. Read the token from the headless context's `localStorage[villagers:${code}]`.
2. Open a new context + page in the **headful** browser.
3. Seed `localStorage[villagers:${code}] = token` on that page (via an init
   script / `addInitScript` before navigation, or `evaluate` + reload).
4. Navigate to `/play/${code}`. The client's `loadToken` restores the player's
   identity and role, and the SSE stream re-sends that player's filtered state.
5. Swap the `Bot`'s `page`/`ctx` references to the headful ones so all
   subsequent actions (`doNightAction`, `doDayVote`, host controls) drive the
   visible page.
6. Close the old headless context.

This is encapsulated as a new `Bot` method, e.g. `migrateTo(browser, url)`,
keeping `run.ts` orchestration readable.

## Phase oracle stays headless and always-on

The round loop in `run.ts` detects the current phase by reading the
**spectator** page's neutral text (night resolve, day vote, day result, game
over). This logic is robust and must not change.

Therefore the sim **always** runs a spectator context as the phase oracle,
regardless of `--player`:

- When `player === "spectator"`, the spectator is the headful, visible window
  (as today).
- For every other pick, the spectator runs **headless** and invisible, used only
  as the phase oracle. The visible window is the chosen host/random/role bot.

This keeps the loop's phase detection identical across all `--player` values.

## Browser launches

Both a headless and a headful `chromium` browser launch, as today. What runs
where depends on the pick:

| Pick | Headful browser holds | Headless browser holds |
|------|-----------------------|------------------------|
| `spectator` | spectator page | all bots |
| `host` | host bot | remaining bots + headless spectator |
| `random` | one chosen non-host bot | remaining bots + host + headless spectator |
| `killer`/`healer`/`villager` | (after start) the migrated bot | all bots initially; spectator stays headless |

## Non-goals

- No change to the autonomous playing logic (strategy, pacing, resolution).
- The operator still does not play; they only watch a different perspective.
- No multi-window mode (only one visible perspective at a time).
- No change to the per-player server-side state filtering — the visible view is
  whatever that real player would legitimately see.

## Testing

- Unit-test `parseArgs` for the new flag: each valid value parses; unknown value
  throws; `--player healer --no-healer` throws; default is `spectator`.
- Manual: run `--player killer`, `--player healer`, `--player villager`,
  `--player host`, `--player random`, and default, confirming the visible window
  shows the correct perspective and the game plays to completion.
