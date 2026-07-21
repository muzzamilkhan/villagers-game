# Audio Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oscillator synth in `lib/sound.ts` with looping ambient beds + recorded stings, keeping the `useSound()` API identical so consuming pages are untouched.

**Architecture:** Split `lib/sound.ts` into a **pure decision layer** (phase → bed/sting resolution + crossfade planning — unit-tested) and a thin **Web Audio player** (loads/decodes the 8 `.ogg` files, plays looping beds with crossfades and layered one-shot stings). The existing oscillator `CUES`/`playCue` stay as a graceful fallback when the audio path is unavailable. `useSound()` keeps the same `{ enabled, toggle, playForPhase }` shape.

**Tech Stack:** TypeScript, React 18 hooks, Web Audio API, `tsx --test` (node:test) for the pure layer — the same runner as `sim/__tests__`.

## Global Constraints

- Public API of `useSound()` unchanged: `{ enabled: boolean; toggle: () => void; playForPhase: (phase, winner?) => void }`. Consuming pages (`app/play/[code]/page.tsx`, `app/observe/[code]/page.tsx`) must need **zero** edits.
- Sound opt-in, off by default, remembered in `localStorage` key `villagers:sound` (`"on"` / `"off"`) — unchanged.
- Assets already committed in `public/audio/`: `bed-night.ogg`, `bed-day.ogg`, `sting-night.ogg`, `sting-dawn.ogg`, `sting-day.ogg`, `sting-verdict.ogg`, `sting-win.ogg`, `sting-loss.ogg`.
- Phase → asset map (single source of truth):
  - `night_action` → bed `night`, sting `night`
  - `resolve` → no bed, sting `dawn`
  - `day_vote` → bed `day`, sting `day`
  - `day_result` → no bed, sting `verdict`
  - `game_over` → no bed, sting `loss` if `winner === "killers"` else `win`
  - `lobby` / other → nothing
- Bedless phases fade the current bed out to silence (~0.8s crossfade duration).
- Keep the oscillator synth as fallback; do not delete it.
- Pure-layer tests run under `tsx --test` and go in `lib/__tests__/`. Add an npm script `test:unit` to run them.
- Run `npm run lint` and `npm run build` before the final commit.

---

## File Structure

- `lib/sound-plan.ts` (new) — pure, no browser APIs: asset names, phase→asset map, and the `planTransition()` function that decides what the player must do on a phase change. Unit-tested.
- `lib/__tests__/sound-plan.test.ts` (new) — node:test unit tests for the pure layer.
- `lib/sound.ts` (modify) — the `useSound` hook + Web Audio player, now consuming `sound-plan.ts`; oscillator synth retained as fallback.
- `package.json` (modify) — add `test:unit` script.

---

### Task 1: Pure decision layer (`sound-plan.ts`)

**Files:**
- Create: `lib/sound-plan.ts`
- Create: `lib/__tests__/sound-plan.test.ts`
- Modify: `package.json` (add `test:unit` script)

**Interfaces:**
- Consumes: `Phase`, `ClientState` from `lib/types.ts` (for `Phase` and `ClientState["winner"]`).
- Produces:
  - `type BedId = "night" | "day"`
  - `type StingId = "night" | "dawn" | "day" | "verdict" | "win" | "loss"`
  - `const BED_FILES: Record<BedId, string>` and `const STING_FILES: Record<StingId, string>` — map id → public path (e.g. `"/audio/bed-night.ogg"`).
  - `const ALL_AUDIO_FILES: string[]` — every path to preload (2 beds + 6 stings).
  - `function bedForPhase(phase: Phase): BedId | null`
  - `function stingForPhase(phase: Phase, winner?: ClientState["winner"]): StingId | null`
  - `interface Transition { sting: StingId | null; bed: BedId | null; bedChanged: boolean }`
  - `function planTransition(phase: Phase, winner: ClientState["winner"] | undefined, currentBed: BedId | null): Transition` — `bed` is the target bed (or null), `bedChanged` is true when `bed !== currentBed` (so the player knows whether to crossfade or leave the bed alone), `sting` is the sting to fire.

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/sound-plan.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bedForPhase,
  stingForPhase,
  planTransition,
  BED_FILES,
  STING_FILES,
  ALL_AUDIO_FILES,
} from "../sound-plan";

test("bedForPhase maps only night/day to beds", () => {
  assert.equal(bedForPhase("night_action"), "night");
  assert.equal(bedForPhase("day_vote"), "day");
  assert.equal(bedForPhase("resolve"), null);
  assert.equal(bedForPhase("day_result"), null);
  assert.equal(bedForPhase("game_over"), null);
  assert.equal(bedForPhase("lobby"), null);
});

test("stingForPhase covers every audible phase", () => {
  assert.equal(stingForPhase("night_action"), "night");
  assert.equal(stingForPhase("resolve"), "dawn");
  assert.equal(stingForPhase("day_vote"), "day");
  assert.equal(stingForPhase("day_result"), "verdict");
  assert.equal(stingForPhase("lobby"), null);
});

test("game_over sting depends on winner", () => {
  assert.equal(stingForPhase("game_over", "killers"), "loss");
  assert.equal(stingForPhase("game_over", "villagers"), "win");
  assert.equal(stingForPhase("game_over", undefined), "win");
});

test("planTransition crossfades when the bed changes", () => {
  const t = planTransition("day_vote", undefined, "night");
  assert.equal(t.bed, "day");
  assert.equal(t.bedChanged, true);
  assert.equal(t.sting, "day");
});

test("planTransition leaves the bed alone when it is unchanged", () => {
  const t = planTransition("night_action", undefined, "night");
  assert.equal(t.bed, "night");
  assert.equal(t.bedChanged, false);
  assert.equal(t.sting, "night");
});

test("planTransition fades to silence on a bedless phase", () => {
  const t = planTransition("resolve", undefined, "night");
  assert.equal(t.bed, null);
  assert.equal(t.bedChanged, true);
  assert.equal(t.sting, "dawn");
});

test("planTransition on a bedless phase with no current bed does not change the bed", () => {
  const t = planTransition("day_result", undefined, null);
  assert.equal(t.bed, null);
  assert.equal(t.bedChanged, false);
  assert.equal(t.sting, "verdict");
});

test("file maps and preload list are consistent", () => {
  assert.equal(BED_FILES.night, "/audio/bed-night.ogg");
  assert.equal(STING_FILES.verdict, "/audio/sting-verdict.ogg");
  assert.equal(ALL_AUDIO_FILES.length, 8);
  assert.ok(ALL_AUDIO_FILES.includes("/audio/bed-day.ogg"));
  assert.ok(ALL_AUDIO_FILES.includes("/audio/sting-loss.ogg"));
});
```

- [ ] **Step 2: Add the `test:unit` script and run to verify failure**

In `package.json` `scripts`, add after the `sim:test` line:

```json
    "test:unit": "tsx --test lib/__tests__/*.test.ts"
```

Run: `npm run test:unit`
Expected: FAIL — cannot find module `../sound-plan`.

- [ ] **Step 3: Write the pure layer**

Create `lib/sound-plan.ts`:

```ts
import type { ClientState, Phase } from "./types";

// The two looping ambient beds and the six one-shot stings, keyed by a short id.
// These ids are the single source of truth for the phase→asset mapping below.
export type BedId = "night" | "day";
export type StingId = "night" | "dawn" | "day" | "verdict" | "win" | "loss";

export const BED_FILES: Record<BedId, string> = {
  night: "/audio/bed-night.ogg",
  day: "/audio/bed-day.ogg",
};

export const STING_FILES: Record<StingId, string> = {
  night: "/audio/sting-night.ogg",
  dawn: "/audio/sting-dawn.ogg",
  day: "/audio/sting-day.ogg",
  verdict: "/audio/sting-verdict.ogg",
  win: "/audio/sting-win.ogg",
  loss: "/audio/sting-loss.ogg",
};

// Every file to preload/decode when sound is enabled.
export const ALL_AUDIO_FILES: string[] = [
  ...Object.values(BED_FILES),
  ...Object.values(STING_FILES),
];

// Only night and day have a continuous ambient bed. resolve/day_result/game_over
// are brief transition moments — sting only, bed fades to silence.
export function bedForPhase(phase: Phase): BedId | null {
  switch (phase) {
    case "night_action":
      return "night";
    case "day_vote":
      return "day";
    default:
      return null;
  }
}

// The one-shot cue fired on entering a phase. game_over depends on who won.
export function stingForPhase(
  phase: Phase,
  winner?: ClientState["winner"]
): StingId | null {
  switch (phase) {
    case "night_action":
      return "night";
    case "resolve":
      return "dawn";
    case "day_vote":
      return "day";
    case "day_result":
      return "verdict";
    case "game_over":
      return winner === "killers" ? "loss" : "win";
    default:
      return null;
  }
}

// What the player must do on a phase change: which sting to fire, which bed
// should be playing afterwards, and whether that differs from the current bed
// (so the player knows to crossfade rather than restart an already-playing bed).
export interface Transition {
  sting: StingId | null;
  bed: BedId | null;
  bedChanged: boolean;
}

export function planTransition(
  phase: Phase,
  winner: ClientState["winner"] | undefined,
  currentBed: BedId | null
): Transition {
  const bed = bedForPhase(phase);
  return {
    sting: stingForPhase(phase, winner),
    bed,
    bedChanged: bed !== currentBed,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/sound-plan.ts lib/__tests__/sound-plan.test.ts package.json
git commit -m "Add pure audio decision layer (phase → bed/sting) with tests"
```

---

### Task 2: Web Audio player + rewired `useSound`

**Files:**
- Modify: `lib/sound.ts`

**Interfaces:**
- Consumes: `planTransition`, `Transition`, `BedId`, `BED_FILES`, `STING_FILES`, `ALL_AUDIO_FILES` from `lib/sound-plan.ts`; existing `CUES`/`playCue`/`cueForPhase` stay in `sound.ts` as fallback.
- Produces: unchanged `useSound()` returning `{ enabled, toggle, playForPhase }`.

This task has no automated test (Web Audio node wiring isn't practically testable headless — the decision logic it depends on is already covered by Task 1). It is verified manually in-app in Task 3.

- [ ] **Step 1: Add the buffer-loading + player internals to `sound.ts`**

Keep the existing `Cue`/`Tone`/`CUES`/`playCue`/`cueForPhase` code (the fallback). Add, above `useSound`:

```ts
import {
  ALL_AUDIO_FILES,
  BED_FILES,
  STING_FILES,
  planTransition,
  type BedId,
} from "./sound-plan";

// Levels: beds sit under table conversation, stings are present but soft.
const BED_LEVEL = 0.35;
const STING_LEVEL = 0.6;
const CROSSFADE = 0.8; // seconds

// Fetch + decode every audio file once, into a path→AudioBuffer map. Failures
// are tolerated: a missing/undecodable file just leaves that entry absent, and
// the caller falls back to the oscillator synth for that cue.
async function loadBuffers(
  ctx: AudioContext
): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  await Promise.all(
    ALL_AUDIO_FILES.map(async (path) => {
      try {
        const res = await fetch(path);
        const arr = await res.arrayBuffer();
        out.set(path, await ctx.decodeAudioData(arr));
      } catch {
        // leave it out; fallback synth covers this cue
      }
    })
  );
  return out;
}

// Holds the currently-looping bed so a phase change can crossfade or leave it.
interface CurrentBed {
  id: BedId;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

// A tiny real-audio player over one AudioContext. Beds loop and crossfade;
// stings are fire-and-forget over their own gain node, layered on top.
class AudioPlayer {
  private bed: CurrentBed | null = null;
  constructor(
    private ctx: AudioContext,
    private buffers: Map<string, AudioBuffer>
  ) {}

  get currentBedId(): BedId | null {
    return this.bed?.id ?? null;
  }

  // Ramp the current bed to silence over CROSSFADE, then stop it.
  private fadeOutCurrent(now: number) {
    if (!this.bed) return;
    const { src, gain } = this.bed;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.0001, now + CROSSFADE);
    src.stop(now + CROSSFADE + 0.05);
    this.bed = null;
  }

  // Start a bed looping, faded in from silence.
  private fadeInBed(id: BedId, now: number) {
    const buf = this.buffers.get(BED_FILES[id]);
    if (!buf) return; // no buffer → simply no bed (sting fallback still fires)
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buf;
    src.loop = true;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(BED_LEVEL, now + CROSSFADE);
    src.connect(gain).connect(this.ctx.destination);
    src.start(now);
    this.bed = { id, src, gain };
  }

  // Crossfade to a new bed id, or to silence when id is null.
  setBed(id: BedId | null, now: number) {
    this.fadeOutCurrent(now);
    if (id) this.fadeInBed(id, now);
  }

  // Fire a one-shot sting layered over the bed. Returns false if its buffer is
  // missing, so the caller can fall back to the synth.
  playSting(path: string, now: number): boolean {
    const buf = this.buffers.get(path);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(STING_LEVEL, now);
    src.connect(gain).connect(this.ctx.destination);
    src.start(now);
    return true;
  }
}
```

- [ ] **Step 2: Rewire `useSound` to use the player, with synth fallback**

Replace the body of the `useSound` hook. Keep the `enabled`/localStorage logic and `ensureContext`; add a player ref + async load, and make `playForPhase` drive bed + sting via `planTransition`, falling back to `playCue` when a sting buffer is missing or the player isn't ready.

Replace the hook (from `export function useSound()` to its closing brace) with:

```ts
export function useSound() {
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    setEnabled(window.localStorage.getItem(STORAGE_KEY) === "on");
  }, []);

  const ensureContext = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) ctxRef.current = new Ctor();
    }
    if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  // Kick off buffer loading once, building the player when decoding is done.
  const ensurePlayer = useCallback((ctx: AudioContext) => {
    if (playerRef.current) return;
    loadBuffers(ctx).then((buffers) => {
      if (buffers.size > 0) playerRef.current = new AudioPlayer(ctx, buffers);
    });
  }, []);

  const toggle = useCallback(() => {
    setEnabled((on) => {
      const next = !on;
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      if (next) {
        const ctx = ensureContext();
        if (ctx) ensurePlayer(ctx);
      }
      return next;
    });
  }, [ensureContext, ensurePlayer]);

  const playForPhase = useCallback(
    (phase: Phase, winner?: ClientState["winner"]) => {
      if (!enabled) return;
      const ctx = ensureContext();
      if (!ctx) return;
      ensurePlayer(ctx);

      const player = playerRef.current;
      const now = ctx.currentTime;

      // Player not ready yet (still decoding): fall back to the synth cue.
      if (!player) {
        const cue = cueForPhase(phase, winner);
        if (cue) playCue(ctx, cue);
        return;
      }

      const plan = planTransition(phase, winner, player.currentBedId);
      if (plan.bedChanged) player.setBed(plan.bed, now);
      if (plan.sting) {
        const ok = player.playSting(STING_FILES[plan.sting], now);
        // Sting buffer missing → fall back to the synth cue for this phase.
        if (!ok) {
          const cue = cueForPhase(phase, winner);
          if (cue) playCue(ctx, cue);
        }
      }
    },
    [enabled, ensureContext, ensurePlayer]
  );

  return { enabled, toggle, playForPhase };
}
```

- [ ] **Step 3: Lint + typecheck**

Run: `npm run lint`
Expected: no errors in `lib/sound.ts` / `lib/sound-plan.ts`.

Run: `npm run build`
Expected: build succeeds (compiles the whole app, catches type errors).

- [ ] **Step 4: Commit**

```bash
git add lib/sound.ts
git commit -m "Play ambient beds + recorded stings; keep synth as fallback"
```

---

### Task 3: Manual in-app verification

**Files:** none (verification only).

Dev server is already running on :3000 (do not start it; see CLAUDE.md / dev.log).

- [ ] **Step 1: Verify the toggle and audio in a real game**

Open `http://localhost:3000`, create a game, and in another tab/window join with a second player so the game can start (or use the sim/observer if quicker). Then:

1. Click the 🔊 toggle — confirm it flips to on and persists on reload (localStorage `villagers:sound`).
2. Start the game → entering `night_action`: the **night bed** should fade in and loop, with the **night sting** over it.
3. Advance to `resolve`: bed **fades to silence**, **dawn sting** plays.
4. `day_vote`: **day bed** fades in (crossfade from silence), **day sting** over it.
5. `day_result`: bed fades to silence, **verdict sting**.
6. Play to `game_over`: **win** or **loss** sting fires; no bed.

Confirm: beds loop without an obvious click at the seam; stings layer cleanly over beds; no console errors.

- [ ] **Step 2: Verify graceful fallback (optional spot-check)**

In DevTools, block one audio request (Network → block `bed-night.ogg`) and reload with sound on. Entering night should still produce a cue (the oscillator fallback) and no uncaught error. Unblock afterwards.

- [ ] **Step 3: Note any sound tweaks**

If a bed seam clicks or a sting is too loud/quiet, adjust `BED_LEVEL` / `STING_LEVEL` / `CROSSFADE` in `lib/sound.ts`, or re-export the file with ffmpeg (see the spec). Commit any tweak with a `tweak:`-style message.

---

## Notes on tests & sim

Per CLAUDE.md, game-flow changes must update Playwright tests and the sim. This change is **client-side audio only, off by default** — it does not touch phases, resolution, or player flow, so the sim and the e2e latency harness need no changes. The pure decision layer is covered by `lib/__tests__/sound-plan.test.ts` (Task 1); the Web Audio wiring is verified manually (Task 3).
