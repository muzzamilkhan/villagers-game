# UI polish: structured outcomes, narration, continue-gate & role toggle

Date: 2026-07-20

A batch of strategically-scoped UI/behaviour changes to the Villagers game,
spanning the player screen, the observer (`/observe`) screen, the ghost view,
and shared narration. Grouped here because several share a new shared module
(`lib/narration.tsx`) and a server-side data-shape change.

## Goals

1. **Structured outcome events** — the server stops sending pre-baked outcome
   sentences and instead sends structured events; the client composes the
   sentence and styles the important words big+bold, discreet words small.
2. **Seeded ambient narration** — atmospheric phase flavor rotates through a
   pool of 10+ variants, chosen by a per-game seeded sequence so everyone
   (players + observer) sees the same line each round.
3. **Continue gate** — every night resolve and day result now holds until the
   host presses **Continue**. Nothing auto-advances past a death/exile.
4. **Player vote fill** — day-vote buttons fill horizontally from the left with
   a darker shade proportional to that candidate's share of the room's votes.
5. **Role card toggle** — the player's own role card is always hidden by default
   and can be tapped to reveal and tapped again to hide; it never auto-unhides.
6. **Ghost view** — dead players no longer see the "tap to reveal your role"
   card at night.
7. **Observer roster** — role/label moves *below* the name; all rows are the
   same height via a fixed-height label slot.
8. **Observer sound** — confirmed no-op; `/observe` already plays no sound.

---

## 1. Structured outcome events

### Types (`lib/types.ts`)

```ts
export type OutcomeEvent =
  | { type: "kill"; player: string }             // player slain in the night
  | { type: "save"; player: string }             // attacked but healer saved
  | { type: "quiet" }                            // no one harmed
  | { type: "castout_killer"; player: string }   // exiled, was a killer
  | { type: "castout_innocent"; player: string } // exiled, was innocent
  | { type: "no_agreement" };                    // tie / no votes → no exile
```

`Room` gains `nightOutcome?: OutcomeEvent[]` and `dayOutcome?: OutcomeEvent[]`,
replacing the `announcement?: string` and `voteResult?: string` fields.
`ClientState` mirrors: `nightOutcome?` / `dayOutcome?` replace `announcement?` /
`voteResult?`.

Arrays (not a single event) for extensibility — today each resolve produces a
one-element array, but the shape allows compound nights later (kill + save).

Player names are already public in `ClientState.players`, so shipping a name in
the outcome leaks nothing new.

### Resolution (`lib/game.ts`)

- `resolveNight` sets `room.nightOutcome` to one of:
  `[{type:"quiet"}]`, `[{type:"save", player}]`, `[{type:"kill", player}]`.
  (The rare "victim record missing" fallback collapses to `[{type:"quiet"}]`.)
- `resolveVote` sets `room.dayOutcome` to one of:
  `[{type:"no_agreement"}]`, `[{type:"castout_killer", player}]`,
  `[{type:"castout_innocent", player}]`.
- `advancePhase` clears `nightOutcome`/`dayOutcome` (where it currently clears
  `announcement`/`voteResult`).
- `buildClientState` passes `nightOutcome`/`dayOutcome` through unchanged.

### Client composition (`lib/narration.tsx`)

A new client module exports an `<Outcome>` component:

```tsx
<Outcome events={state.nightOutcome} />
```

It maps each event to a sentence split into styled segments. Important words
(player name, "Slain", "saved", "cast out", "innocent"/"killer") render at the
**current** size + **bold**; discreet words render **smaller + normal weight**.
Example rendering targets:

- `kill`            → **{name}** was **Slain** in the night.
- `save`            → **{name}** was attacked… the healer's hand kept them **alive**.
- `quiet`           → A **quiet** dawn. No one was harmed.
- `castout_killer`  → **{name}** was **cast out** — and was a **killer**!
- `castout_innocent`→ **{name}** was **cast out** — but was **innocent**.
- `no_agreement`    → The village could **not agree**. No one was cast out.

Implementation: each event maps to an array of `{ text, emphasis }` spans; the
component renders emphasised spans in a `font-bold` span at inherited size and
discreet spans in a smaller (`text-[0.8em]`), non-bold span. Because the parent
already sets `font-display text-xl` (player) / `text-4xl md:text-6xl`
(observer), the emphasis is relative and works at both scales — the `<Outcome>`
component carries no absolute font size of its own.

Used in:
- Player `ResultView` — replaces the `text` string render.
- Observer `Stage` — replaces the `state.announcement` / `state.voteResult`
  render for `resolve` and `day_result`.

---

## 2. Seeded ambient narration

### Seed (`lib/game.ts` role-assignment / start path)

When the game starts (same place roles are assigned), generate
`narrationSeq: number[]` — a length-10 array holding a **shuffled** 0–9 — and
store it on `Room`. `ClientState` carries `narrationSeq` through (public).

### Pools (`lib/narration.tsx`)

Two pools of **≥10** lines each:

- `NIGHT_FLAVOR` — replaces the observer "Under cover of dark…" line.
- `DAWN_FLAVOR` — replaces the player "Dawn breaks over the village…" waiting
  line (and the observer dawn-wait if applicable).

### Selection

`pickNarration(pool, seq, round)` returns `pool[seq[round % seq.length] % pool.length]`.
Both night and dawn use the **same** stored `seq`, indexed by `round`, so:
- the line is stable across SSE re-renders within a round (no flicker), and
- observer + every player resolve to the same line.

If `narrationSeq` is absent (older room / lobby), fall back to
`pool[round % pool.length]`.

---

## 3. Continue gate

Both the night `resolve` screen and the `day_result` screen hold until the host
presses **Continue**; no phase auto-advances. (The phase machine already
advances only on host action — this change is about the *presentation* of the
hold plus the button label and timing.)

Player `ResultView` changes:
- The host advance buttons on `resolve` and `day_result` are both labelled
  **"Continue"** (replacing "Call the Trial" / "Onward to Night").
- Night `resolve` keeps its existing ~3.5s suspense timeout before the
  announcement reveals. **After** the announcement is revealed, wait a further
  **2 seconds**, then show the host Continue button. Before that, the host sees
  the revealed announcement but no button yet.
- Day `day_result` applies the same **2s** delay after the result shows before
  the Continue button appears (consistency).
- Non-host players continue to see a "Waiting for the Village Elder…" hold with
  no auto-advance (unchanged wording).

Implementation: a `continueReady` boolean in `ResultView`, set true by a 2s
timer that starts once the outcome is visible (immediately for day, post-reveal
for night). The host Continue button renders only when `continueReady`.

---

## 4. Player vote button horizontal fill

In `RoundView`, each day-vote candidate button (`crest`) gains an absolutely
positioned fill layer behind the label:

- `width = round((voters.length / voterCount) * 100)%` — share of the whole
  room's eligible voters.
- A darker translucent background (e.g. `bg-black/20`), left-anchored, so the
  button visibly fills from the left toward the middle/right as votes land.
- `transition-[width]` so it animates with the live tally.
- The existing count badge + voter-name list render on top (z-ordered above the
  fill). The button needs `relative overflow-hidden`.

Only on the day vote (`!isNight`); night picks are secret and unchanged.

---

## 5. Role card toggle (always hidden by default)

`RoleCard` / `roleRevealed` in `RoundView`:

- Default **hidden** on every entry to `night_action` (the existing per-round
  reset stays). It must never begin revealed on its own.
- Tapping the hidden card reveals it.
- Tapping the revealed card hides it again (new — the revealed card becomes a
  button that toggles back to hidden).
- Verify no code path sets `roleRevealed` true without a user tap.

---

## 6. Ghost view — no role card

In `RoundView`, `RoleCard` currently renders for **everyone** at night, before
the ghost/alive split — so a dead player sees "Tap to reveal your role."

Change: render the role card at night **only when the viewer is alive**
(`isNight && alive`). Dead players skip straight to the ghost hold. Role no
longer matters to a ghost, so the prompt is removed for them.

---

## 7. Observer roster — role below name, uniform height

In observer `Roster`, each player row currently shows the name (left) and role
(right). Change to a stacked layout:

- Name on top.
- Below it, a **fixed-height label slot** holding the role / host tag:
  - during play: the "(Elder)" host tag (role is hidden pre-game-over);
  - at game-over: the revealed role (`killer`/`healer`/`villager`), plus Elder.
- The slot has a fixed height (e.g. `h-5`) whether or not it has content, so
  every row is the same total height and the grid stays aligned.
- The connected/away dot (shown when no role) moves into or beside this slot
  without changing row height.

---

## 8. Observer sound — no-op

`/observe` does not import `useSound` and plays no cues. "Observer: no sound" is
already satisfied; no change. Documented here so the requirement is accounted
for.

---

## Testing / sim (per CLAUDE.md)

Any game-flow change must update the Playwright tests and the sim. Affected:

- **Continue gate**: the sim / tests that advance through `resolve` and
  `day_result` must click **"Continue"** (label change) and tolerate the 2s
  delay before the button appears.
- **Outcome text**: assertions that matched literal announcement strings
  (e.g. "was slain in the night") must be updated to the new composed wording,
  or matched on a stable substring the `<Outcome>` component still emits.
- **Role toggle / ghost**: any test asserting the ghost sees a role card must be
  updated to assert it does *not*.

Run `npm run build` and `npm run lint` before pushing. Update the Playwright
tests and sim in lockstep with the game-flow changes above.

## Out of scope

- No change to the win logic, phase machine transitions, role assignment, or
  auth/streaming model.
- Outcome *events* are structured, but the resolution *rules* (shared kill,
  heal-repeat block, plurality/tie) are unchanged.
