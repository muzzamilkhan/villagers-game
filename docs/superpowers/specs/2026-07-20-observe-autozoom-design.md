# Observe screen — uniform auto-zoom to fill the display

**Date:** 2026-07-20
**Scope:** Observer view only (`app/observe/[code]/page.tsx`). Purely visual.

## Problem

The observer view (projected on a large shared screen at `/observe/<code>`) renders
its content — Header + Stage + Roster — at a fixed natural size. Font-size caps and
content-sized flex boxes leave the whole layout sitting in roughly the top-left 60% of
the display, with the phase background filling the rest. On a big TV/projector this
wastes most of the screen.

## Goal

Zoom the entire content up as a single unit — everything bigger, **nothing repositioned
relative to anything else** — keeping aspect ratio (no distortion), centered, growing
until it touches the nearest pair of viewport edges. The phase background (which changes
every phase) fills any remaining space on the other axis. Literally "zoom into a photo."

## Approach

A self-contained `AutoZoom` wrapper component inside `app/observe/[code]/page.tsx`.

- Renders existing content (`children`) at natural size in an inner div. **No changes to
  Header / Stage / Roster markup or sizing.**
- Outer container: `flex items-center justify-center`, fills the viewport region inside
  `Screen`'s padding. Centers the zoomed content.
- Measures viewport container and inner content via `ResizeObserver` on both.
- Computes `scale = min(viewportW / contentW, viewportH / contentH)` and applies
  `transform: scale(N)` with `transform-origin: center` to the inner div.
- Recomputes on viewport resize and on content-size change. Phase transitions change
  content dimensions (e.g. lobby vs. game_over), and the inner-content ResizeObserver
  catches those automatically — no phase-specific wiring needed.

### Placement

Inside `Screen`, wrap `{children}` in `<AutoZoom>`. Background `phase-layer` divs stay
outside the zoom — they already `fixed inset-0` and fill the true viewport.

### Edge cases

- Before first measurement (zero-size), scale defaults to `1`.
- `transform` scaling causes no reflow, so text never re-wraps mid-zoom.
- Only scale up/down to fit; no minimum beyond what the formula yields.

## Isolation

`AutoZoom` takes only `children`, owns two refs + one `scale` state value, and has no
dependency on game state. Verifiable by resizing the browser window on the observe page.

## Tests / sim

No phase, resolution, or player-flow change — observer-only visual. Playwright tests and
the sim need no updates. Existing e2e matches on visible text (`getByText`); a CSS
`transform` keeps all text in the DOM and visible, so nothing breaks.
