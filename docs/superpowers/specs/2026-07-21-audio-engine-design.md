# Audio engine: ambient beds + recorded stings

**Date:** 2026-07-21
**Status:** Approved, ready for implementation plan

## Goal

Replace the Web Audio oscillator synth in `lib/sound.ts` with real recorded
audio: a looping ambient **bed** per major phase, plus a one-shot **sting** on
each phase transition. Keep the `useSound()` public API identical so the two
consuming pages (`app/play/[code]/page.tsx`, `app/observe/[code]/page.tsx`)
need **zero changes**.

Sound stays opt-in, off by default, remembered per browser — unchanged.

## Assets

Eight Opus-in-`.ogg` files already produced and committed in `public/audio/`
(~470KB total, mono, 48kHz):

```
beds (looping, 20s, 1.5s fades at edges for a seamless seam):
  bed-night.ogg   bed-day.ogg

stings (one-shot, ≤2.5s; win/loss ~4.5s with a fade tail):
  sting-night.ogg  sting-dawn.ogg  sting-day.ogg
  sting-verdict.ogg  sting-win.ogg  sting-loss.ogg
```

### Phase → asset map

This map is the single source of truth; swapping a sound is a file replace, no
code change.

| Phase          | Bed         | Sting          |
|----------------|-------------|----------------|
| `night_action` | `bed-night` | `sting-night`  |
| `resolve`      | *(none)*    | `sting-dawn`   |
| `day_vote`     | `bed-day`   | `sting-day`    |
| `day_result`   | *(none)*    | `sting-verdict`|
| `game_over`    | *(none)*    | `sting-win` \| `sting-loss` (by `winner`) |
| `lobby`, other | *(none)*    | *(none)*       |

`game_over` sting: `sting-loss` when `winner === "killers"`, else `sting-win`
(mirrors current cue logic).

## Architecture

One shared `AudioContext`, created lazily on the enabling user gesture
(browsers block audio before a gesture). All state lives in refs inside the
existing `useSound` hook — no new global state, no server involvement (audio is
entirely client-side).

### Loading

On enable (toggle → on), fetch + `decodeAudioData` all eight files in parallel
and cache the resulting `AudioBuffer`s in a ref-held map. Decoding once up front
means the first phase cue isn't delayed by a network round-trip. ~470KB is
trivial to hold decoded in memory.

### Bed player (looping, crossfaded)

A single "current bed" slot tracks which bed (if any) is playing and its
`AudioBufferSourceNode` + gain node.

On `playForPhase`, resolve the new phase's bed:
- **New bed differs from current:** create a new source (`loop = true`) on its
  own gain node; ramp new gain 0 → bed level and old gain → 0 over ~0.8s
  (crossfade); stop + disconnect the old source after the fade.
- **Same bed as current:** leave it playing untouched (no restart, no seam).
- **No bed for this phase** (`resolve`, `day_result`, `game_over`, `lobby`):
  fade the current bed out to silence over ~0.8s and clear the slot. (Decision:
  option A — bedless phases go quiet so the dawn/gavel stings have space.)

### Sting player (one-shot, layered)

Fire-and-forget: a fresh `AudioBufferSourceNode` through a dedicated sting gain
node, started immediately, layered over whatever the bed is doing. No tracking
needed — it stops itself when the buffer ends.

### Levels

A modest master/per-role gain so beds sit under table conversation and stings
are audibly present but not startling. Exact values tuned during implementation;
beds quieter than stings.

## Graceful fallback

Keep the existing oscillator synth (`CUES` + `playCue`) as a fallback path, not
deleted. If `AudioContext` is unavailable, or `decodeAudioData` fails / a fetch
errors, fall back to the synthesized cue for that phase. A decode failure or an
ancient browser still gets *something* on each transition.

## Public API (unchanged)

`useSound()` returns the same shape:
- `enabled: boolean` — localStorage-backed opt-in (`villagers:sound`), unchanged.
- `toggle()` — flips the preference; turning **on** now also kicks off asset
  preload/decode (in addition to creating/resuming the context).
- `playForPhase(phase, winner?)` — same signature; now drives **both** the bed
  crossfade and the sting (replacing the single synth blip).

Because the signature is identical, both consuming pages are untouched.

## Testing & sim

Per CLAUDE.md, game-flow changes must update Playwright tests and the sim.
Sound is client-side and off by default, so **game flow is unchanged** — no sim
change needed. For Playwright: verify existing sound-toggle coverage; extend so
the toggle still flips on/off and enabling doesn't throw when the audio path
runs (real decode won't happen headless — assert graceful behavior / no error,
not actual playback).

## Out of scope

- Volume slider / multiple levels (single fixed level for now — YAGNI).
- Per-phase bed variety beyond night/day.
- Music beyond the two ambient beds.
- Committing the source `.wav` originals (already deleted; user has a copy).
