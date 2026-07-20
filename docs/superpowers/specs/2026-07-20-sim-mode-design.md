# Villagers Sim Mode — Design

**Date:** 2026-07-20
**Status:** Approved, ready for implementation planning

## Goal

A standalone Node/Playwright script that spins up N headless "bot" players
against the **live** Villagers deployment
(`https://villagers-game-pied.vercel.app/`), plays a full game with human-like
pacing, and lets the operator observe it live through a real (non-headless)
spectator browser. The operator does **not** play — they watch. One bot hosts
and creates the room; the rest join. After everyone has joined, the sim pauses
for the operator to confirm before the game starts.

## Inputs

Passed as CLI flags to `npm run sim -- ...`. All optional; defaults applied when
omitted.

| Flag | Default | Maps to |
| --- | --- | --- |
| `--bots <n>` | `8` | number of bot players (host + joiners) |
| `--killers <1\|2>` | `1` | `GameSettings.killers` |
| `--healer` / `--no-healer` | healer on | `GameSettings.healer` |
| `--ghost-votes` / `--no-ghost-votes` | off | `GameSettings.ghostVotes` |
| `--max-players <n>` | `max(bots, minPlayersToStart)` | `GameSettings.maxPlayers` |
| `--url <url>` | live Vercel URL | target deployment |

`actionTimerSec` is **not** operator-configurable: the create form hardcodes it
to 60, and the sim relies on that. Bots must therefore all submit their night
action within 60s (easily met — see Pacing).

Validation: `bots` must be ≥ `minPlayersToStart({ killers })`
(4 for one killer, 6 for two) and ≤ 10 (the game cap). `max-players` must be ≥
`bots`. Bad input exits with a clear message before any browser launches.

## Architecture

New `sim/` directory, kept separate from `e2e/` (which is the latency harness,
left untouched). Uses the Playwright **library API** directly
(`chromium.launch()`), not the `@playwright/test` runner — the test runner fights
against an interactive stdin pause and long human-paced waits.

```
sim/
  run.ts        entry point: arg parsing, orchestration, teardown
  bot.ts        Bot class — one browser context/page, role + alive state, actions
  strategy.ts   "light strategy" decision logic (who to kill/heal/vote)
  pacing.ts     randomized human-like delays
  ui.ts         shared selectors + DOM helpers (waitForPhase, clickTarget, awaitSee)
```

Run via a new `package.json` script:

```json
"sim": "tsx sim/run.ts"
```

(`tsx` added as a dev dependency to run TypeScript directly; if a lighter option
is preferred at implementation time, `ts-node` is acceptable.)

### Bot

Each bot owns its **own isolated browser context and page** (one SSE stream
each — exactly like separate phones). State tracked locally: `name`, `role`,
`alive`, `isHost`, and `lastHealTarget` (healer only). Bots read live facts
(current phase, living players, fellow killers) from their **filtered DOM**
rather than assuming, so eliminations and role knowledge are always respected.

The **host bot** additionally holds the game-control buttons ("Begin the Game",
"Call the Trial", "Lock in the Votes", "Onward to Night") and drives phase
transitions.

## Flow

1. **Create.** Host bot (headless) → live URL → "Create a Game" → fill name →
   apply settings (killers buttons `1`/`2`, healer + ghost-votes Yes/No toggles,
   max-players via `fill` on the range `input`) → "Create" → read the 4-letter
   code from the `/play/{code}` URL.
2. **Spectator.** Launch a **non-headless** browser → live URL → "Spectate" →
   enter code → land on `/observe/{code}`. This is the operator's window.
3. **Join.** Bots `1..N-1` (headless) join with the code, one at a time, with
   small human-ish gaps so the lobby populates naturally.
4. **Pause.** Print the code + lobby summary, then
   `▶ Press Enter to start the game...` and block on stdin.
5. **Start.** On Enter → host clicks "Begin the Game". Every bot taps its own
   "Tap to reveal your role" card and records its role. Killers thereby learn
   who their fellow killer is from their own filtered state.
6. **Round loop** (night → day) until `game_over` (see below).
7. **Teardown.** On game over, print the winner, keep the spectator window open
   until the operator presses Enter again (so they can read the final screen),
   then close all contexts.

## Round loop & light strategy

Mirrors the real state machine: **night auto-resolves** once every living
player submits; **day votes** require the host to lock in.

### Night (`night_action`)

All living bots act **concurrently**, each after its own random 2–8s delay
(parallel, not serial — so total night time stays well under the 60s timer):

- **Killers** coordinate on **one shared victim** (the game requires all killers
  to agree, else no kill). Deterministic agreement: all killers pick the same
  living non-killer chosen by a stable rule (e.g. first in join order among
  living non-killers). If that victim is itself a killer, skip to the next
  non-killer.
- **Healer** protects a random living player, honoring the "can't heal the same
  target two nights running" rule via locally-tracked `lastHealTarget`; if the
  only option would repeat, pick a different living player (or self).
- **Villagers** submit a harmless pick (any living player). Night villager picks
  don't affect resolution, but every living player must submit for auto-resolve.

After the last submit, the night auto-resolves. Bots wait for the dawn
announcement; the host clicks **"Call the Trial"** once that button appears.

### Day (`day_vote`)

Each eligible voter (living, plus ghosts when `ghostVotes` is on) acts after a
random 2–8s delay:

- **Killers** vote together for a living villager (steer suspicion away from
  themselves).
- **Villagers / healer** vote for a random living player other than themselves.
  Ties → no elimination (realistic and acceptable).

Host waits for the full tally, clicks **"Lock in the Votes"**. If the result
does not end the game, host clicks **"Onward to Night"** to advance.

### Termination

Loop ends when `game_over` is detected (village-win or killers-win text /
`winner`). A safety cap of **20 rounds** prevents a pathological tie-loop from
running forever; hitting the cap logs a warning and stops.

## Phase detection & driving from DOM

Bots determine the current phase by polling `document.body.innerText` for known
markers (reused from the existing e2e harness):

| Phase | Marker(s) |
| --- | --- |
| Night action | crest picker + "chosen" counter |
| Dawn hold | "Dawn breaks over the village" → host waits for "Call the Trial" |
| Day vote | "Vote for who you suspect" + crest buttons |
| Day result | "was cast out" / no-elimination text → host "Onward to Night" |
| Game over | "The Village Prevails" / killers-win text |

Phase transitions are driven off the **host's** page (it holds the control
buttons); each bot acts when it sees the crest picker for the current phase.

Proven selectors reused from `e2e/concurrency-latency.spec.ts`:

- Target crest: `button.crest` containing `span.text-lg` with the target's name.
- Host controls: `getByRole("button", { name: ... })`.
- `awaitSee(page, texts)` / `waitForPhase(page, markers)`: poll body innerText.

## Pacing

`sim/pacing.ts` exposes `humanDelay()` → a random delay in **2000–8000 ms**.
Applied per bot per action. Because bots within a phase run concurrently, a full
night/day resolves in roughly one such delay, not N of them — comfortably inside
the 60s night timer. (A `--speed`/delay-range flag is explicitly out of scope
for v1; realistic pacing is the fixed default.)

## Error handling

- Entire run wrapped in try/finally; **always** close all contexts.
- If a bot can't find its expected control within a timeout, log which
  bot/phase and dump a DOM snippet (as the existing harness does), then abort
  gracefully.
- Round safety cap (20) guards against infinite tie loops.
- `SIGINT` (Ctrl-C) handler closes browsers cleanly before exit.

## Testing / verification

No automated tests for the sim itself — it is an interactive observation tool
run against live production; correctness is verified by **watching a full game
play through** in the spectator window. The implementation's verification step
is a real end-to-end run against the live URL that reaches `game_over`.

## Out of scope (YAGNI)

- Configurable pacing / speed flags.
- Multiple concurrent games.
- Bot chat / naming personalities beyond simple `Bot 1..N` names.
- Any changes to the game itself or the existing `e2e/` harness.
- Scripted/deterministic outcomes — outcomes emerge from light strategy + RNG.
