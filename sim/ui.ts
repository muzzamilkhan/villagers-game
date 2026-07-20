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

// Names shown on the viewer's own screen that are still alive. Living crest
// buttons are enabled; eliminated players are rendered struck/disabled. We read
// the enabled crest labels.
export async function readLivingNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button.crest")) as HTMLButtonElement[];
    return btns
      .filter((b) => !b.disabled)
      .map((b) => b.querySelector("span.text-lg")?.textContent?.trim() ?? "")
      .filter(Boolean);
  });
}

// A killer's own screen marks fellow killers. Villager/healer screens never
// reveal roles, so this returns [] for them. We read any crest/player row that
// carries the killer role badge text.
export async function readFellowKillers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-role='killer'], .role-killer"));
    return rows
      .map((r) => r.querySelector("span.text-lg")?.textContent?.trim() ?? r.textContent?.trim() ?? "")
      .filter(Boolean);
  });
}
