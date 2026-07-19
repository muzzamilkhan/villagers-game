# Villagers

A medieval, mobile-first social-deduction party game — think Mafia/Werewolf as a
web app. One phone per player, one shared game code, discussion happens out loud.

## How it plays

1. A **host** creates a game, picks settings (1–2 killers, optional healer, max
   players), and gets a 4-letter join code.
2. Players **join** with the code and a name. The host can kick and then starts.
3. Roles are assigned secretly: **killer(s)**, an optional **healer**, and
   **villagers**.
4. Each round:
   - **Night** — *everyone* taps a target on an identical screen. The killer's
     tap is a kill, the healer's tap is a save, a villager's tap does nothing.
     (Same UI for all, so a shoulder-surfer can't tell a killer's move from a
     villager's.)
   - **Dawn** — the victim dies unless the healer shielded them; the outcome is
     announced either way.
   - **Trial** — players debate, then vote a suspect. The host locks the votes.
   - **Verdict** — reveal whether a killer was caught.
5. Repeat until all killers are caught (**villagers win**) or the killers reach
   parity with the living villagers (**killers win**).

### Rules baked in
- Two killers know each other and must **agree on one shared kill** per night.
- The healer may self-save but **can't shield the same person twice in a row**.
- **Tie vote → no one is eliminated.**
- Night action **times out → no kill** that night.
- The **dead are silent ghosts**: they watch, but can't act, vote, or chat.

### Observer mode (big screen)
Pick **Observe a Game** on the landing page and enter the code — no name needed.
This opens a full-screen, read-only view (`/observe/CODE`) meant to be projected
so the whole room can follow along: the current phase, a live day-vote tally, the
roster of who's alive or fallen, and every role revealed once the game ends.
Observers only ever receive **public** state — hidden roles are never sent to the
projected screen — and they can't act, vote, or affect the game.

## Stack

- **Next.js 15** (App Router) — UI + API route handlers, deployable on Vercel.
- **Redis** (Upstash in production) — single source of truth for game state and
  pub/sub fan-out.
- **Server-Sent Events** for server→client state; plain `POST` for actions. No
  separate socket server needed. Each SSE stream is filtered **per player**, so
  roles are never sent to a client that shouldn't see them.
- **Reconnection**: every player gets a private token in `localStorage`; a
  refresh reopens the stream and restores identity + role.

## Running locally

```bash
npm install
cp .env.example .env.local   # set REDIS_URL (local: redis://localhost:6379)
redis-server &               # or point at Upstash
npm run dev
```

Open http://localhost:3000, host a game on one browser, join with the code from
others (or extra tabs).

## Deploying

Set `REDIS_URL` to your Upstash Redis **TCP** connection string (`rediss://…`,
from the Upstash console → Connect → ioredis/TCP — not the REST URL) and deploy
to Vercel.

## Project layout

```
app/
  page.tsx                     landing — create, join, or observe
  play/[code]/page.tsx         the whole game (host controls shown inline)
  observe/[code]/page.tsx      read-only big-screen spectator view
  api/room/create              create a room
  api/room/[code]/join         join / kick / start / action / vote / advance
  api/room/[code]/stream       SSE — per-player filtered state (?observer=1 for spectators)
lib/
  types.ts   redis.ts   codes.ts   game.ts (state machine)   client.ts (hooks)
```
