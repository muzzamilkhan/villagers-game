function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// All killers run this over the same living-non-killer list (in join order),
// so they independently converge on the same victim — the game requires
// unanimous killer agreement for a kill to land.
export function chooseKillTarget(livingNonKillers: string[]): string {
  if (livingNonKillers.length === 0) throw new Error("no target to kill");
  return livingNonKillers[0];
}

export function chooseHealTarget(
  living: string[],
  self: string,
  lastHeal: string | undefined,
): string {
  const options = living.filter((n) => n !== lastHeal);
  if (options.length > 0) return pick(options);
  return pick(living); // forced to repeat — only when lastHeal is the sole living player
}

export function chooseVote(
  living: string[],
  self: string,
  killerNames: string[],
  amKiller: boolean,
): string {
  const candidates = amKiller
    ? living.filter((n) => !killerNames.includes(n))
    : living.filter((n) => n !== self);
  const safe = candidates.length > 0 ? candidates : living.filter((n) => n !== self);
  return pick(safe);
}
