# Observe Auto-Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zoom the observer view's content up as one unit — everything bigger, nothing repositioned, aspect ratio locked, centered — to fill the display.

**Architecture:** A self-contained `AutoZoom` wrapper in `app/observe/[code]/page.tsx` measures its viewport container and inner content with `ResizeObserver`, computes `scale = min(vw/cw, vh/ch)`, and applies `transform: scale(N)` (origin center) to the inner div. Centered via flex. No changes to Header/Stage/Roster.

**Tech Stack:** Next.js 15 client component, React 18 hooks (`useRef`, `useState`, `useLayoutEffect`), `ResizeObserver`.

## Global Constraints

- Observer view only. No phase/resolution/flow change.
- Do NOT modify Header/Stage/Roster markup or sizing.
- Background `phase-layer` divs stay outside the zoom (they `fixed inset-0`).
- Verification is visual (browser), not unit tests — this is a CSS-transform layout change with no testable pure-function surface.

---

### Task 1: AutoZoom wrapper + wire into Screen

**Files:**
- Modify: `app/observe/[code]/page.tsx` (add `AutoZoom` component; wrap `{children}` in `Screen`)

**Interfaces:**
- Produces: `AutoZoom({ children }: { children: React.ReactNode })` — a component that renders children at natural size and CSS-scales them to fit, centered.

- [ ] **Step 1: Add `AutoZoom` component**

```tsx
function AutoZoom({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      // Divide inner's rendered size back out by the current scale to recover
      // its natural (unscaled) size, then fit that to the outer box.
      const cw = inner.offsetWidth;
      const ch = inner.offsetHeight;
      if (cw === 0 || ch === 0) return;
      const next = Math.min(outer.clientWidth / cw, outer.clientHeight / ch);
      setScale(next > 0 ? next : 1);
    };
    // offsetWidth/Height are the layout (pre-transform) size, so measuring is
    // scale-independent — safe to observe both boxes.
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    measure();
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className="flex flex-1 items-center justify-center overflow-hidden">
      <div ref={innerRef} style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add React imports**

At top of file, ensure `useLayoutEffect`, `useRef`, `useState` are imported from `react` (currently only `use` is imported):

```tsx
import { use, useLayoutEffect, useRef, useState } from "react";
```

- [ ] **Step 3: Wrap children in Screen**

In `Screen`, replace the bare `{children}` with `<AutoZoom>{children}</AutoZoom>`.

Note: the inner content must keep its own layout. The existing `Header` + the `flex flex-1 ... lg:flex-row` block are the children; they render at natural size inside `AutoZoom`'s inner div. Because the inner div is no longer a flex-1 child that stretches, wrap the observe page's returned children so they have a definite natural size — they already do (Header is content-height, the Stage/Roster row is content-height). The `flex-1` on the Stage/Roster row will collapse to content height inside an unconstrained inner div, which is the desired "natural size" to scale. Confirm visually.

- [ ] **Step 4: Verify in browser**

Start a game, grab the code, open `/observe/<code>` at 3000. Confirm content is centered and zoomed to touch the nearest edges, aspect ratio preserved, nothing repositioned. Resize window — zoom recomputes. Advance phases — zoom re-fits per phase (lobby vs game_over differ).

- [ ] **Step 5: Build + lint**

Run: `npm run build && npm run lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add app/observe/[code]/page.tsx docs/superpowers
git commit -m "observe: uniform auto-zoom content to fill display"
```
