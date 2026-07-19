# e2e — concurrency & latency harness

`concurrency-latency.spec.ts` spins up **10 real players (host + 9 joiners) and
1 passive observer**, each in its own isolated browser context with its own SSE
stream — exactly like 11 phones on the same game. It then drives a full
two-round game to a deterministic villagers win and, for every kind of
broadcast, measures how long each *other* screen takes to reflect the move.

## What it measures

| Event | What triggers it |
| --- | --- |
| `player_join` | a new player joins the lobby — how fast everyone else sees them |
| `game_start` | host starts the game — how fast all screens flip to night |
| `night_action_progress` | each night pick — how fast the "x / y chosen" counter updates elsewhere |
| `night_resolve` | the dawn reveal after the last pick |
| `night_to_day` | host opens the trial |
| `vote_tally_progress` | each vote — how fast the live tally climbs on other screens |
| `day_result` | an elimination is announced |
| `day_to_night` | host advances to the next night |
| `game_over` | the final result reveal |

At the end it prints a **min / avg / p50 / p95 / max** table per event and writes
`e2e/results/latency-report.{json,md}` (git-ignored).

Every sample is the wall-clock time between an actor performing a move and one
watcher's DOM reflecting it (the SSE round-trip), gathered across all 11 screens
concurrently so the numbers reflect real fan-out latency.

## Running

```bash
npm run test:e2e
```

The Playwright config:

- builds and serves a **production** Next.js build (port 3100) so numbers reflect
  real request/SSE latency, not dev's on-demand compile;
- starts a **throwaway local Redis** (port 6399, persistence off) in
  `global-setup` and tears it down after — nothing is left running, and it won't
  touch a `redis-server` you already have on 6379;
- launches the pre-installed system Chromium (`PLAYWRIGHT_BROWSERS_PATH`), so no
  browser download is needed.

Overrides via env: `VILLAGERS_TEST_PORT`, `VILLAGERS_TEST_REDIS_URL`,
`PLAYWRIGHT_CHROMIUM_PATH`.
