import type { Page } from "playwright";
import type { Role } from "./types.ts";

export async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? "");
}

export async function awaitSee(page: Page, texts: string[], timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    (ts: string[]) => {
      const body = document.body?.innerText ?? "";
      return ts.some((t) => body.includes(t));
    },
    texts,
    { polling: 50, timeout },
  );
}

// Click a target crest / vote button by the target's name. The name only
// appears in the button's primary label (span.text-lg), never in the smaller
// voter list, so a substring match on the unique name is unambiguous.
export async function clickTarget(page: Page, name: string): Promise<void> {
  const btn = page
    .locator("button.crest", { has: page.locator("span.text-lg", { hasText: name }) })
    .first();
  await btn.click();
}

export async function revealRole(page: Page): Promise<Role> {
  await page.getByText("Tap to reveal your role").click();
  const title = (await page.locator("p.text-3xl").first().innerText()).trim().toLowerCase();
  return title as Role;
}

// Names shown on the viewer's own screen that are still alive. Confirmed live
// (sim/probe.ts against prod, 2026-07-20): app/play/[code]/page.tsx renders
// `button.crest` only for `state.players.filter(p => p.alive && p.token !==
// you.token)` — i.e. the target grid during night_action/day_vote. There is
// no `disabled` attribute; eliminated players (and self) simply aren't
// rendered at all, rather than being shown struck-through. So this is really
// "living targets other than me," which is exactly what callers need.
export async function readLivingNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button.crest"));
    return btns
      .map((b) => b.querySelector("span.text-lg")?.textContent?.trim() ?? "")
      .filter(Boolean);
  });
}

// A killer's own screen marks fellow killers. Confirmed live (sim/probe.ts):
// there is no `[data-role]` attribute or `.role-killer` class anywhere in the
// app. Instead, RoleCard (app/play/[code]/page.tsx) renders, once the killer
// reveals their role, a plain-text line: `With you: Name1, Name2` inside a
// `<p class="mt-2 font-display text-blood">`. Villager/healer screens never
// render this paragraph, so this returns [] for them.
export async function readFellowKillers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const p = Array.from(document.querySelectorAll("p.text-blood")).find((el) =>
      el.textContent?.trim().startsWith("With you:")
    );
    const text = p?.textContent?.replace("With you:", "").trim() ?? "";
    return text
      ? text.split(",").map((n) => n.trim()).filter(Boolean)
      : [];
  });
}
