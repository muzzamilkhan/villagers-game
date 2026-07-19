# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Project

**Villagers** — a medieval, mobile-first social-deduction party game (Mafia/
Werewolf as a web app). One phone per player, one shared 4-letter game code,
discussion happens out loud. See `README.md` for the full rules and player flow.

## Workflow (hobby project)

- **Work directly on `main`.** No feature branches, no PRs unless explicitly asked.
- **Always commit and push when work is done.** Don't leave changes uncommitted.
- Keep it lightweight — this is a personal hobby project.

## Stack

- **Next.js 15** (App Router) — UI + API route handlers, deploys on Vercel.
- **React 18**, **TypeScript**, **Tailwind CSS**.
- **Redis** via `ioredis` (Upstash in production) — the single source of truth
  for all game state, plus pub/sub fan-out. No database.
- **Server-Sent Events** for server→client state; plain `POST` for actions.
- **nanoid** for player tokens and (via `customAlphabet`) room codes.

## Architecture

State lives entirely in Redis (keys in `lib/redis.ts`; rooms self-expire after
4h via `ROOM_TTL_SEC`):

- `room:{code}` — the `Room` JSON (phase, round, settings, host token, outcome).
- `room:{code}:players` — hash of `token → Player` JSON.
- `room:{code}:order` — list preserving join order.
- `room:{code}:actions` / `:votes` — per-round scratch, `token → target`.
- `room:{code}:channel` — pub/sub channel; publishes are a bare "update" nudge.

**Auth is by token, not session.** Every player gets a private `token` (nanoid)
stored in their browser `localStorage`. It's passed in POST bodies and the SSE
query string, and identifies + authorizes the player on reconnect. The host is
whoever holds `room.hostToken`.

**Per-player state filtering is the core invariant.** `buildClientState` in
`lib/game.ts` builds a `ClientState` tailored to each viewer — roles of others
are hidden unless the viewer is a killer (killers know each other) or the game
is over. Every SSE stream re-runs this filter on each publish, so roles are
never sent to a client that shouldn't see them. **Preserve this when touching
state or the stream.**

**Real-time flow:** any mutation calls `publish(code)`; each player's SSE stream
(`app/api/room/[code]/stream/route.ts`, one dedicated Redis subscriber
connection each) re-reads and re-filters state and pushes a fresh `state` event.

## Game phases & rules

Phases (`lib/types.ts`): `lobby → night_action → resolve → day_vote →
day_result → game_over` (loops night→day each round). Resolution logic lives in
`lib/game.ts`:

- **Night** (`resolveNight`): killers must *all agree on one shared target* or
  no kill; the healer's save cancels a kill but **can't repeat the same target
  two nights running** (`lastHealTarget`). Auto-resolves once every living
  player has submitted.
- **Day** (`resolveVote`): plurality vote, **ties → no elimination**.
- **Win** (`checkWin`): killers all dead → villagers win; killers ≥ other living
  players → killers win.

## Layout

```
app/
  page.tsx                      landing — create or join
  layout.tsx  globals.css
  play/[code]/page.tsx          the whole game UI (host controls inline)
  api/room/create               POST — create a room
  api/room/[code]/join          POST — join
  api/room/[code]/kick          POST — host kicks a player
  api/room/[code]/start         POST — host starts (assigns roles)
  api/room/[code]/action        POST — night pick (auto-resolves when all in)
  api/room/[code]/vote          POST — day vote
  api/room/[code]/advance       POST — host advances phase
  api/room/[code]/stream        GET  — SSE, per-player filtered state
lib/
  types.ts   Room/Player/ClientState + Phase/Role
  redis.ts   connection, keys, publish, TTL
  codes.ts   room-code generation (unambiguous alphabet) + normalize
  game.ts    state machine: io, role assignment, resolution, client view
  client.ts  React hooks for the SSE stream + actions
```

All API routes use `runtime = "nodejs"` and `dynamic = "force-dynamic"` (they
hit Redis and stream). Route params are async: `await params`.

## Running locally

```bash
npm install
cp .env.example .env.local   # set REDIS_URL (local: redis://localhost:6379)
redis-server &               # or point at Upstash
npm run dev                  # http://localhost:3000
```

`npm run build` / `npm run lint` before pushing anything non-trivial. Deploy:
set `REDIS_URL` to the Upstash **TCP** string (`rediss://…`) on Vercel.
