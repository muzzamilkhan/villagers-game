# UI Narration, Continue-Gate, Outcomes & Role-Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a batch of Villagers UI changes: structured outcome events styled on the client, seeded ambient narration, a host "Continue" hold on every resolve, a horizontal vote-fill, an always-hidden toggleable role card, a ghost with no role card, and a stacked observer roster — keeping the sim and Playwright e2e in sync.

**Architecture:** The server stops shipping pre-baked outcome sentences and instead ships structured `OutcomeEvent[]` plus a per-game `narrationSeq`. A new shared client module `lib/narration.tsx` composes styled sentences (`<Outcome>`) and picks ambient lines (`pickNarration`). Player and observer screens both consume it. Sim (`sim/`) and e2e (`e2e/`) matchers are updated for the new wording and the "Continue" label.

**Tech Stack:** Next.js 15 (App Router), React 18, TypeScript, Tailwind, Redis (state), Playwright (e2e), tsx + node:test (sim unit tests).

## Global Constraints

- Work directly on `main`. Commit frequently. (CLAUDE.md)
- With every game-flow change, update Playwright tests **and** the sim. (CLAUDE.md)
- `npm run build` and `npm run lint` must pass before pushing. (CLAUDE.md)
- Per-player state filtering in `buildClientState` is the core invariant: never send hidden roles to a viewer who shouldn't see them. Outcome events carry only player **names** (already public) — never roles. (CLAUDE.md)
- All API routes: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `await params`. (unchanged — no new routes here)

---

### Task 1: Outcome event types + narration seed on Room/ClientState

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Produces:
  - `type OutcomeEvent = { type: "kill"; player: string } | { type: "save"; player: string } | { type: "quiet" } | { type: "castout_killer"; player: string } | { type: "castout_innocent"; player: string } | { type: "no_agreement" }`
  - `Room.nightOutcome?: OutcomeEvent[]` and `Room.dayOutcome?: OutcomeEvent[]` (replace `announcement?`/`voteResult?`)
  - `Room.narrationSeq?: number[]`
  - `ClientState.nightOutcome?: OutcomeEvent[]`, `ClientState.dayOutcome?: OutcomeEvent[]`, `ClientState.narrationSeq?: number[]` (replace `announcement?`/`voteResult?`)

- [ ] **Step 1: Add `OutcomeEvent` type**

In `lib/types.ts`, after the `Role`/`Phase` types add:

```ts
// A single thing that happened at a resolution, sent structured so the client
// can compose the sentence and style the important words. Carries only player
// NAMES (already public) — never roles.
export type OutcomeEvent =
  | { type: "kill"; player: string }
  | { type: "save"; player: string }
  | { type: "quiet" }
  | { type: "castout_killer"; player: string }
  | { type: "castout_innocent"; player: string }
  | { type: "no_agreement" };
```

- [ ] **Step 2: Update `Room`**

In `interface Room`, replace:

```ts
  // resolution announcement for the current round
  announcement?: string;
  // outcome of the last day vote
  voteResult?: string;
```

with:

```ts
  // structured resolution outcome for the current round (client composes text)
  nightOutcome?: OutcomeEvent[];
  // structured outcome of the last day vote
  dayOutcome?: OutcomeEvent[];
  // per-game shuffled 0..9 sequence; indexes the ambient narration pools by
  // round so every player + the observer see the same flavor line each round.
  narrationSeq?: number[];
```

- [ ] **Step 3: Update `ClientState`**

In `interface ClientState`, replace:

```ts
  announcement?: string;
  voteResult?: string;
```

with:

```ts
  nightOutcome?: OutcomeEvent[];
  dayOutcome?: OutcomeEvent[];
  narrationSeq?: number[];
```

- [ ] **Step 4: Verify it compiles (expect downstream errors)**

Run: `npx tsc --noEmit`
Expected: FAIL — errors in `lib/game.ts` (still references `room.announcement` / `voteResult`) and in the two page components. These are fixed in later tasks. Confirm the errors are only about `announcement`/`voteResult`/`nightOutcome`/`dayOutcome`, not about the new type shape itself.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts
git commit -m "types: structured outcome events + narration seed"
```

---

### Task 2: Server resolution emits structured outcomes + seeds narration

**Files:**
- Modify: `lib/game.ts` (`resolveNight`, `resolveVote`, `advancePhase`, `assignRoles`/start path, `buildClientState`)

**Interfaces:**
- Consumes: `OutcomeEvent`, `Room.nightOutcome/dayOutcome/narrationSeq`, `ClientState.*` from Task 1.
- Produces: rooms whose resolutions set `nightOutcome`/`dayOutcome`; `assignRoles` result carries `narrationSeq`; `buildClientState` passes all three through.

- [ ] **Step 1: Seed `narrationSeq` at game start**

`assignRoles` is where a game is set up (called from the start route). It returns players, not a room — so seed on the room instead. Find where the start route builds/saves the room after assigning roles. Search:

Run: `grep -rn "assignRoles\|phase = \"night_action\"\|night_action" app/api/room/*/start/route.ts`

In that start route, when transitioning the room to `night_action`, set:

```ts
room.narrationSeq = shuffle10();
```

Add the helper to `lib/game.ts` and export it:

```ts
// A shuffled 0..9 used to index the ambient narration pools by round, so the
// flavor line is stable per round and identical for every viewer.
export function shuffle10(): number[] {
  return shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
}
```

(`shuffle` already exists in `lib/game.ts`.)

- [ ] **Step 2: `resolveNight` emits `nightOutcome`**

In `resolveNight`, replace the announcement-string block. Where it currently computes `announcement` and sets `room.announcement`, produce events instead:

```ts
  let nightOutcome: OutcomeEvent[];
  if (!victim) {
    nightOutcome = [{ type: "quiet" }];
  } else if (effectiveHeal === victim) {
    const name = byToken.get(victim)?.name ?? "someone";
    nightOutcome = [{ type: "save", player: name }];
  } else {
    const p = byToken.get(victim);
    if (p) {
      p.alive = false;
      await savePlayer(code, p);
      nightOutcome = [{ type: "kill", player: p.name }];
    } else {
      nightOutcome = [{ type: "quiet" }];
    }
  }

  room.nightOutcome = nightOutcome;
```

Remove the old `room.announcement = announcement;` line and the `announcement` string variable. Keep `room.lastHealTarget = effectiveHeal;`, `room.phase = "resolve";`, the `del(keys.actions)` and `saveRoom`.

Add `OutcomeEvent` to the type import at the top of `lib/game.ts`.

- [ ] **Step 3: `resolveVote` emits `dayOutcome`**

In `resolveVote`, replace the `result` string block:

```ts
  let dayOutcome: OutcomeEvent[];
  if (!top || tie || topCount === 0) {
    dayOutcome = [{ type: "no_agreement" }];
  } else {
    const p = byToken.get(top);
    if (p) {
      p.alive = false;
      await savePlayer(code, p);
      dayOutcome =
        p.role === "killer"
          ? [{ type: "castout_killer", player: p.name }]
          : [{ type: "castout_innocent", player: p.name }];
    } else {
      dayOutcome = [{ type: "no_agreement" }];
    }
  }

  room.dayOutcome = dayOutcome;
```

Remove `room.voteResult = result;` and the `result` variable. Keep `room.phase = "day_result";`, `del(keys.votes)`, `saveRoom`.

- [ ] **Step 4: `advancePhase` clears the new fields**

In `advancePhase`, in the `case "day_result":` block, replace:

```ts
      room.announcement = undefined;
      room.voteResult = undefined;
```

with:

```ts
      room.nightOutcome = undefined;
      room.dayOutcome = undefined;
```

(Leave `narrationSeq` intact — it lives for the whole game.)

- [ ] **Step 5: `buildClientState` passes the new fields through**

In the returned object of `buildClientState`, replace:

```ts
    announcement: room.announcement,
    voteResult: room.voteResult,
```

with:

```ts
    nightOutcome: room.nightOutcome,
    dayOutcome: room.dayOutcome,
    narrationSeq: room.narrationSeq,
```

- [ ] **Step 6: Verify game.ts + start route compile**

Run: `npx tsc --noEmit 2>&1 | grep -E "lib/game.ts|start/route.ts"`
Expected: no output (those files clean). Remaining errors should only be in `app/play/[code]/page.tsx` and `app/observe/[code]/page.tsx`, fixed next.

- [ ] **Step 7: Commit**

```bash
git add lib/game.ts app/api/room/*/start/route.ts
git commit -m "game: emit structured outcomes and seed per-game narration"
```

---

### Task 3: Shared narration module — `<Outcome>` + pools + picker

**Files:**
- Create: `lib/narration.tsx`

**Interfaces:**
- Consumes: `OutcomeEvent` from Task 1.
- Produces:
  - `export function Outcome({ events }: { events?: OutcomeEvent[] }): JSX.Element | null`
  - `export const NIGHT_FLAVOR: string[]` (≥10)
  - `export const DAWN_FLAVOR: string[]` (≥10)
  - `export function pickNarration(pool: string[], seq: number[] | undefined, round: number): string`

- [ ] **Step 1: Create the module with pools + picker**

Create `lib/narration.tsx`:

```tsx
import type { OutcomeEvent } from "./types";

// Ambient, atmospheric flavor shown during the night and dawn beats. These are
// NOT outcomes — they never say who died. One line is chosen per round via the
// game's shuffled narrationSeq so every viewer sees the same line.
export const NIGHT_FLAVOR: string[] = [
  "Under cover of dark, choices are made in silence.",
  "The village bolts its doors and waits for morning.",
  "Candles gutter out, one by one, across the sleeping village.",
  "Somewhere in the dark, a decision takes shape.",
  "The night is long, and not everyone means to see the dawn.",
  "Shutters close. Breath held. The village sleeps uneasy.",
  "Only the moon watches what moves between the houses.",
  "A cold wind walks the empty lanes while the village dreams.",
  "In the hush, unseen hands are at work.",
  "The fire burns low; shadows lengthen and conspire.",
  "No lantern dares to burn tonight.",
];

// Shown while the dawn resolution is held back for suspense.
export const DAWN_FLAVOR: string[] = [
  "Dawn breaks over the village…",
  "First light creeps across the rooftops…",
  "The village stirs, bracing for the news…",
  "Morning comes, whether it is welcome or not…",
  "A pale sun rises on whatever the night has left…",
  "The cockerel crows into an uncertain morning…",
  "Doors creak open onto the cold light of day…",
  "The village counts itself awake, and holds its breath…",
  "Grey light spills over the square…",
  "The night releases its grip; the truth waits in the light…",
  "Dew and dread settle together on the morning…",
];

// Deterministically pick a line: index the pool through the per-game shuffled
// sequence, keyed by round, so it is stable across re-renders and identical for
// every viewer. Falls back to a plain round index when no seed exists.
export function pickNarration(
  pool: string[],
  seq: number[] | undefined,
  round: number,
): string {
  const i = seq && seq.length ? seq[round % seq.length] : round;
  return pool[i % pool.length];
}

// One span of composed outcome text: `emphasis` words stand out (bold, at the
// inherited font size); the rest are smaller and un-bold, so the important
// words (name, "Slain", "cast out"…) carry the moment.
interface Span {
  text: string;
  emphasis?: boolean;
}

function spansFor(e: OutcomeEvent): Span[] {
  switch (e.type) {
    case "kill":
      return [
        { text: e.player, emphasis: true },
        { text: " was " },
        { text: "Slain", emphasis: true },
        { text: " in the night." },
      ];
    case "save":
      return [
        { text: e.player, emphasis: true },
        { text: " was attacked — but the healer's hand kept them " },
        { text: "alive", emphasis: true },
        { text: "." },
      ];
    case "quiet":
      return [
        { text: "A " },
        { text: "quiet", emphasis: true },
        { text: " dawn. No one was harmed." },
      ];
    case "castout_killer":
      return [
        { text: e.player, emphasis: true },
        { text: " was " },
        { text: "cast out", emphasis: true },
        { text: " — and was a " },
        { text: "killer", emphasis: true },
        { text: "!" },
      ];
    case "castout_innocent":
      return [
        { text: e.player, emphasis: true },
        { text: " was " },
        { text: "cast out", emphasis: true },
        { text: " — but was " },
        { text: "innocent", emphasis: true },
        { text: "." },
      ];
    case "no_agreement":
      return [
        { text: "The village could " },
        { text: "not agree", emphasis: true },
        { text: ". No one was cast out." },
      ];
  }
}

// Renders composed outcome text. Emphasis spans inherit the parent font size and
// are bold; discreet spans are smaller (0.8em) and normal weight. Carries no
// absolute size of its own, so it scales with the parent on both the player card
// (text-xl) and the observer stage (text-4xl md:text-6xl).
export function Outcome({ events }: { events?: OutcomeEvent[] }) {
  if (!events || events.length === 0) return null;
  return (
    <>
      {events.map((e, i) => (
        <span key={i} className="block">
          {spansFor(e).map((s, j) =>
            s.emphasis ? (
              <span key={j} className="font-bold">
                {s.text}
              </span>
            ) : (
              <span key={j} className="text-[0.8em] font-normal opacity-90">
                {s.text}
              </span>
            ),
          )}
        </span>
      ))}
    </>
  );
}
```

Note the composed sentences preserve the substrings `"{name} was Slain"` and `"{name} was cast out"` in reading order, which the sim/e2e death matchers rely on (updated in later tasks to be case-insensitive on "slain").

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep "lib/narration"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/narration.tsx
git commit -m "narration: shared Outcome composer + seeded flavor pools"
```

---

### Task 4: Player screen — Outcome, Continue-gate, vote-fill, role toggle, ghost card

**Files:**
- Modify: `app/play/[code]/page.tsx` (`ResultView`, `RoundView`, `RoleCard`)

**Interfaces:**
- Consumes: `Outcome`, `DAWN_FLAVOR`, `pickNarration` from Task 3; `ClientState.nightOutcome/dayOutcome/narrationSeq` from Task 1.

- [ ] **Step 1: Import the narration module**

At the top of `app/play/[code]/page.tsx`, add:

```ts
import { Outcome, DAWN_FLAVOR, pickNarration } from "@/lib/narration";
```

- [ ] **Step 2: `ResultView` — render `<Outcome>` + Continue-gate**

Replace the body of `ResultView` with:

```tsx
function ResultView({
  state,
  isHost,
  act,
}: {
  state: ClientState;
  isHost: boolean;
  act: (p: string, b: Record<string, unknown>) => void;
}) {
  const isNight = state.phase === "resolve";
  const events = isNight ? state.nightOutcome : state.dayOutcome;

  // Night holds a ~3.5s suspense before the reveal; day reveals immediately.
  const [revealed, setRevealed] = useState(!isNight);
  // A death/exile is a big deal: after the outcome is visible, wait 2s before
  // the host may advance, so everyone can soak it in. Nothing auto-advances.
  const [continueReady, setContinueReady] = useState(false);

  useEffect(() => {
    if (!isNight) {
      setRevealed(true);
      return;
    }
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 3500);
    return () => clearTimeout(t);
  }, [isNight]);

  useEffect(() => {
    if (!revealed) return;
    setContinueReady(false);
    const t = setTimeout(() => setContinueReady(true), 2000);
    return () => clearTimeout(t);
  }, [revealed]);

  if (isNight && !revealed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="animate-pulse font-display text-2xl text-parchment/85">
          {pickNarration(DAWN_FLAVOR, state.narrationSeq, state.round)}
        </p>
        <p className="text-sm text-parchment/50">
          The deeds of the night come to light.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="card flex flex-1 flex-col items-center justify-center p-6 text-center">
        <p className="font-display text-xl leading-relaxed text-ink">
          <Outcome events={events} />
        </p>
      </div>
      {isHost ? (
        continueReady ? (
          <button className="btn btn-primary" onClick={() => act("advance", {})}>
            Continue
          </button>
        ) : (
          <p className="text-center text-parchment/60">Let it settle…</p>
        )
      ) : (
        <p className="text-center text-parchment/60">
          Waiting for the Village Elder…
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `RoleCard` — toggle hide/show, always hidden by default**

Replace `RoleCard` so the revealed card is a button that hides again:

```tsx
function RoleCard({
  state,
  revealed,
  onToggle,
}: {
  state: ClientState;
  revealed: boolean;
  onToggle: () => void;
}) {
  const info = ROLE_INFO[state.you.role];
  if (!revealed) {
    return (
      <button className="card p-6 text-center" onClick={onToggle}>
        <p className="font-display text-lg">Tap to reveal your role</p>
        <p className="mt-1 text-sm text-wood">(make sure no one is looking)</p>
      </button>
    );
  }
  const fellowKillers =
    state.you.role === "killer"
      ? state.players.filter(
          (p) => p.role === "killer" && p.token !== state.you.token
        )
      : [];
  return (
    <button className="card w-full p-5 text-center" onClick={onToggle}>
      <p className={`font-display text-3xl font-bold ${info.color}`}>
        {info.title}
      </p>
      <p className="mt-2 text-sm text-wood">{info.blurb}</p>
      {fellowKillers.length > 0 && (
        <p className="mt-2 font-display text-blood">
          With you: {fellowKillers.map((p) => p.name).join(", ")}
        </p>
      )}
      <p className="mt-3 text-xs text-wood/70">(tap to hide)</p>
    </button>
  );
}
```

- [ ] **Step 4: `RoundView` — role card only when alive + toggle wiring**

In `RoundView`, change the role-card render so it shows only for living players and passes a toggle. Replace:

```tsx
      {isNight && (
        <RoleCard state={state} revealed={roleRevealed} onReveal={onReveal} />
      )}
```

with:

```tsx
      {isNight && alive && (
        <RoleCard
          state={state}
          revealed={roleRevealed}
          onToggle={onToggle}
        />
      )}
```

Update `RoundView`'s props: rename `onReveal` to `onToggle` in the destructure and the type. In the parent `GamePage`, change the prop passed to `RoundView` from `onReveal={() => setRoleRevealed(true)}` to `onToggle={() => setRoleRevealed((v) => !v)}`.

Confirm nothing sets `roleRevealed` true except the toggle: the only other write is the per-round reset `setRoleRevealed(false)` in `GamePage`'s effect — that stays (keeps it hidden by default each night). Good.

- [ ] **Step 5: `RoundView` — horizontal vote fill**

In the day-vote button in `RoundView`, add a fill layer. The button currently is:

```tsx
                <button
                  key={p.token}
                  className={`crest ${
                    picked
                      ? "border-gold bg-gold/30"
                      : "border-wood-light bg-wood/40"
                  }`}
                  onClick={() => act(path, { target: p.token })}
                >
```

Change its className to add `relative overflow-hidden` and, as the first child inside the button, add the fill (day only). Replace the button opening + insert fill:

```tsx
                <button
                  key={p.token}
                  className={`crest relative overflow-hidden ${
                    picked
                      ? "border-gold bg-gold/30"
                      : "border-wood-light bg-wood/40"
                  }`}
                  onClick={() => act(path, { target: p.token })}
                >
                  {!isNight && state.voterCount > 0 && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-0 bg-black/20 transition-[width] duration-500"
                      style={{
                        width: `${Math.round(
                          (voters.length / state.voterCount) * 100
                        )}%`,
                      }}
                    />
                  )}
```

The existing label/badge spans that follow must render above the fill. Wrap the existing inner content (the `span.text-lg` name span and the voter-list span) so they sit in a `relative z-10` layer — add `className="relative z-10 flex flex-col items-center"` to a wrapping `<span>` around the current children, or add `relative z-10` to each. Simplest: wrap:

```tsx
                  <span className="relative z-10 flex flex-col items-center">
                    {/* existing: name span, chosen/your-vote span, voter list */}
                  </span>
```

Keep the inner `span.text-lg` name span intact (the sim's `clickTarget`/`readLivingNames` select `button.crest span.text-lg`).

- [ ] **Step 6: Build + lint**

Run: `npm run build && npm run lint`
Expected: PASS, no type or lint errors.

- [ ] **Step 7: Manual smoke via dev (already running on :3000)**

Dev server is already running (per user global instructions; see `dev.log`). Do NOT start another. Sanity-check the player screen renders (role toggle hides/shows, Continue appears after delay) by driving the sim in Task 7, or a quick manual pass. No automated assertion here.

- [ ] **Step 8: Commit**

```bash
git add app/play/[code]/page.tsx
git commit -m "play: Outcome text, Continue-gate, vote-fill, role toggle, ghost card"
```

---

### Task 5: Observer screen — Outcome + seeded night flavor + stacked roster

**Files:**
- Modify: `app/observe/[code]/page.tsx` (`Stage`, `Roster`)

**Interfaces:**
- Consumes: `Outcome`, `NIGHT_FLAVOR`, `pickNarration` from Task 3; `ClientState.nightOutcome/dayOutcome/narrationSeq`.

- [ ] **Step 1: Import narration module**

At the top of `app/observe/[code]/page.tsx`:

```ts
import { Outcome, NIGHT_FLAVOR, pickNarration } from "@/lib/narration";
```

- [ ] **Step 2: `Stage` — night flavor + Outcome for resolve/day_result**

In `Stage`, in the `night_action` block, replace the hard-coded line:

```tsx
          <p className="text-xl text-wood md:text-2xl">
            Under cover of dark, choices are made in silence.
          </p>
```

with:

```tsx
          <p className="text-xl text-wood md:text-2xl">
            {pickNarration(NIGHT_FLAVOR, state.narrationSeq, state.round)}
          </p>
```

Replace the `resolve` block:

```tsx
      {state.phase === "resolve" && (
        <p className="font-display text-4xl leading-relaxed text-ink md:text-6xl">
          {state.announcement ?? "Dawn breaks over the village…"}
        </p>
      )}
```

with:

```tsx
      {state.phase === "resolve" && (
        <p className="font-display text-4xl leading-relaxed text-ink md:text-6xl">
          {state.nightOutcome ? (
            <Outcome events={state.nightOutcome} />
          ) : (
            "Dawn breaks over the village…"
          )}
        </p>
      )}
```

Replace the `day_result` block:

```tsx
      {state.phase === "day_result" && (
        <p className="font-display text-4xl leading-relaxed text-ink md:text-6xl">
          {state.voteResult ?? "The village deliberates…"}
        </p>
      )}
```

with:

```tsx
      {state.phase === "day_result" && (
        <p className="font-display text-4xl leading-relaxed text-ink md:text-6xl">
          {state.dayOutcome ? (
            <Outcome events={state.dayOutcome} />
          ) : (
            "The village deliberates…"
          )}
        </p>
      )}
```

- [ ] **Step 3: `Roster` — stack role/label below name, uniform row height**

In `Roster`, replace the per-player row's inner content. Current row `<div>` uses `justify-between` with name on the left and role/dot on the right. Change to a stacked column with a fixed-height label slot so all rows match. Replace the mapped row body:

```tsx
          <div
            key={p.token}
            className={`flex flex-col rounded-lg border-2 px-4 py-3 ${
              p.alive
                ? "border-wood-light bg-wood/40"
                : "border-wood-light/40 bg-black/30 opacity-60"
            }`}
          >
            <span className="flex items-center gap-2 font-display text-xl md:text-2xl">
              {!p.alive && <span aria-hidden>💀</span>}
              <span
                className={
                  p.alive
                    ? "text-parchment"
                    : "text-parchment/50 line-through"
                }
              >
                {p.name}
              </span>
            </span>
            {/* Fixed-height label slot so every row is the same height whether
                or not it carries a role/host tag. */}
            <span className="mt-0.5 flex h-5 items-center gap-2 text-sm">
              {p.isHost && <span className="text-gold">(Elder)</span>}
              {p.role ? (
                <span className={`font-display ${ROLE_COLOR[p.role]}`}>
                  ({p.role})
                </span>
              ) : (
                !p.isHost && (
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      p.connected ? "bg-forest" : "bg-wood-light/50"
                    }`}
                    title={p.connected ? "connected" : "away"}
                  />
                )
              )}
            </span>
          </div>
```

(The host row's dot is dropped in favor of the "(Elder)" tag; the slot's fixed `h-5` keeps every row aligned.)

- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/observe/[code]/page.tsx
git commit -m "observe: Outcome text, seeded night flavor, stacked roster"
```

---

### Task 6: Update the sim to the new labels + wording

**Files:**
- Modify: `sim/bot.ts` (`callTrial`, `onward`)
- Modify: `sim/run.ts` (`syncDeaths` matcher, resolve/day waits)
- Modify: `sim/ui.ts` (`revealRole` — role card is now a `<button>`; selector still matches, but confirm)

**Interfaces:**
- Consumes: the running app from Tasks 4–5.

- [ ] **Step 1: `sim/bot.ts` — Continue button**

Replace `callTrial` and `onward` bodies so both click the single **Continue** button. Because the button now appears ~2s after the reveal, wait for visibility first:

```ts
  async callTrial(): Promise<void> {
    const btn = this.page.getByRole("button", { name: "Continue", exact: true });
    await btn.waitFor({ state: "visible" });
    await btn.click();
  }

  async onward(): Promise<void> {
    const btn = this.page.getByRole("button", { name: "Continue", exact: true });
    await btn.waitFor({ state: "visible" });
    await btn.click();
  }
```

- [ ] **Step 2: `sim/run.ts` — death matcher is wording-resilient**

`syncDeaths` currently matches `"{name} was slain"` / `"{name} was cast out"`. The new composed text reads `"{name} was Slain in the night."` and `"{name} was cast out — …"`. Update the verb matching to be case-insensitive and phrase-tolerant:

```ts
function syncDeaths(
  bots: Bot[],
  text: string,
  round: number,
  phase: "night" | "day",
): void {
  const lower = text.toLowerCase();
  const verb = phase === "night" ? "slain" : "cast out";
  for (const b of bots) {
    if (!b.alive) continue;
    // Composed outcome text keeps "{name} … {verb}" in reading order
    // (lib/narration.tsx). Match name followed by the verb, case-insensitive.
    const nameIdx = lower.indexOf(b.name.toLowerCase());
    if (nameIdx !== -1 && lower.indexOf(verb, nameIdx) !== -1) {
      b.alive = false;
      console.log(`  [round ${round}] ${phase}: ${b.name} died`);
    }
  }
}
```

- [ ] **Step 3: `sim/run.ts` — day-result wait wording**

The `"day result"` step waits on `["was cast out", "No one was cast out", ...]`. New wording: cast-out still contains `"cast out"`; the no-elimination case is now `"No one was cast out."` (from `no_agreement` → "The village could not agree. No one was cast out."). Update to:

```ts
      await step("day result", specPage, ["cast out", "No one was cast out", ...GAME_OVER_TEXTS]);
```

(`"cast out"` covers both castout events; `"No one was cast out"` covers `no_agreement`.)

- [ ] **Step 4: `sim/run.ts` — night resolve wait**

The `"night resolve"` step waits on `["Dawn", ...]`. The observer no longer prints the word "Dawn" in the stage (it shows the `<Outcome>` text). But the observer **Header** still renders `PHASE_LABEL.resolve = "Dawn"` — so `"Dawn"` still appears on the observer page during resolve. Leave this wait as-is. Add a clarifying comment:

```ts
      // Observer Header still shows the "Dawn" phase label during resolve even
      // though the stage now renders composed Outcome text. Either that or a
      // game-over banner (a lethal night can end the game with no resolve beat).
      await step("night resolve", specPage, ["Dawn", ...GAME_OVER_TEXTS]);
```

- [ ] **Step 5: `sim/ui.ts` — confirm `revealRole` still works**

`revealRole` clicks `getByText("Tap to reveal your role")` then reads `p.text-3xl`. The role card is now a `<button>` but the "Tap to reveal your role" text and the revealed `p.text-3xl` title are unchanged. No change needed — but add nothing and verify by running the sim in Step 6. If the revealed title selector broke, note the role card title is still `<p className="font-display text-3xl font-bold …">`.

- [ ] **Step 6: Run the sim end-to-end**

The dev server is already on :3000 (do not start another).

Run: `npm run sim -- --bots 4 --killers 1 --healer yes`
When prompted, press Enter to start, and again to exit.
Expected: the sim runs a full game to a "Game over — …" line with no `[STALLED]` dumps, and `[round N] night/day: <name> died` lines appear as players die. This exercises the Continue button, the new wording, and death sync.

- [ ] **Step 7: Run sim unit tests**

Run: `npm run sim:test`
Expected: all existing tests PASS (strategy/args/names/pacing untouched).

- [ ] **Step 8: Commit**

```bash
git add sim/bot.ts sim/run.ts sim/ui.ts
git commit -m "sim: Continue button, resilient death matcher, updated waits"
```

---

### Task 7: Update the Playwright e2e for new labels + wording

**Files:**
- Modify: `e2e/concurrency-latency.spec.ts`

**Interfaces:**
- Consumes: the running app from Tasks 4–5.

- [ ] **Step 1: Night resolve watcher — seeded dawn line**

The player night-resolve watcher waits on `["Dawn breaks over the village"]` (the player hold text) and `["kept them alive"]` (the save outcome). The hold text is now seeded (may not be "Dawn breaks over the village"). Both the player hold line and the observer are unreliable to match on exact flavor now. Change the player watcher to match on the stable per-player suspense subline instead. In `runNight`'s `night_resolve` measure, replace:

```ts
        playerWatchers(["Dawn breaks over the village"], ["kept them alive"]),
```

with:

```ts
        // Player hold shows a seeded flavor line + the stable subline below it;
        // observer shows the save-outcome ("alive"). Match the stable bits.
        playerWatchers(["The deeds of the night come to light"], ["alive"]),
```

(The player card's second line `"The deeds of the night come to light."` is fixed; the observer's `save` outcome renders "…kept them alive." → contains "alive".)

- [ ] **Step 2: Call-the-trial → Continue**

Replace the `callTrial` locator:

```ts
      const callTrial = host.page.getByRole("button", { name: "Call the Trial" });
      await callTrial.waitFor({ state: "visible" });
```

with:

```ts
      // Host advance is a single "Continue" button, shown ~2s after the reveal.
      const callTrial = host.page.getByRole("button", { name: "Continue", exact: true });
      await callTrial.waitFor({ state: "visible" });
```

- [ ] **Step 3: Day result watcher wording**

The `runDayVote` resolve watcher for round 1 passes `playerWatchers(["was cast out"], ["was cast out"], false)`. The composed text still contains `"cast out"`. Loosen to the substring:

```ts
      playerWatchers(["cast out"], ["cast out"], false)
```

Apply the same change to any other `runDayVote` call in the file that passes a cast-out watcher (search for `"was cast out"`).

- [ ] **Step 4: Onward-to-night → Continue**

Replace:

```ts
        await host.page.getByRole("button", { name: "Onward to Night" }).click();
```

with (there may be more than one occurrence — update all):

```ts
        await host.page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
```

Because two `Continue` buttons never coexist (resolve and day_result are different phases), `exact: true` name match is unambiguous per phase.

- [ ] **Step 5: Grep for any remaining stale labels/wording**

Run: `grep -n "Call the Trial\|Onward to Night\|was slain\|was cast out\|Dawn breaks over the village" e2e/concurrency-latency.spec.ts`
Expected: no output. Fix any remaining hits by the same substitutions above.

- [ ] **Step 6: Run the e2e suite**

The dev server is already on :3000. Playwright global-setup may expect a base URL; run the suite:

Run: `npm run test:e2e`
Expected: PASS. If a test stalls on a wording wait, re-check Steps 1–4 against the actual rendered text (use `npm run test:e2e:report`).

- [ ] **Step 7: Commit**

```bash
git add e2e/concurrency-latency.spec.ts
git commit -m "e2e: Continue button + updated outcome wording"
```

---

### Task 8: Final verification + push

**Files:** none (verification only)

- [ ] **Step 1: Full build + lint**

Run: `npm run build && npm run lint`
Expected: PASS, clean.

- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Grep for orphaned old fields**

Run: `grep -rn "announcement\|voteResult" lib/ app/ sim/ e2e/ | grep -v "nightOutcome\|dayOutcome\|// "`
Expected: no output (all references to the old string fields removed). Investigate any hit.

- [ ] **Step 4: Push**

```bash
git push
```

- [ ] **Step 5: Report**

Summarize to the user what changed, that build/lint/sim/e2e pass, and that it's pushed.

---

## Self-Review

**Spec coverage:**
- §1 structured outcomes → Tasks 1, 2, 3 (Outcome), 4, 5. ✓
- §2 seeded narration → Task 1 (field), 2 (seed), 3 (pools/picker), 4 & 5 (usage). ✓
- §3 continue gate (2s after reveal, both resolves, "Continue") → Task 4 Step 2. ✓
- §4 vote fill → Task 4 Step 5. ✓
- §5 role toggle always-hidden → Task 4 Steps 3–4. ✓
- §6 ghost no role card → Task 4 Step 4 (`isNight && alive`). ✓
- §7 observer roster stacked, uniform height → Task 5 Step 3. ✓
- §8 observer no sound → no-op, no task needed (documented in spec). ✓
- CLAUDE.md sim + Playwright sync → Tasks 6, 7. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases"; every code step shows full code. ✓

**Type consistency:** `OutcomeEvent`, `nightOutcome`/`dayOutcome`/`narrationSeq`, `shuffle10`, `Outcome`, `pickNarration`, `NIGHT_FLAVOR`, `DAWN_FLAVOR` used consistently across tasks. `RoleCard` prop renamed `onReveal`→`onToggle` consistently in Task 4 Steps 3–4. ✓
