// Short, unambiguous first-name-only medieval names. Short so a substring
// match on the crest button label (span.text-lg) is unambiguous, and each is
// distinct from every other as a substring.
export const NAME_POOL = [
  "Reginald",
  "Morwenna",
  "Cuthbert",
  "Isolde",
  "Percival",
  "Rowena",
  "Alaric",
  "Beatrix",
  "Godfrey",
  "Ysabel",
  "Tancred",
  "Odilia",
] as const;

// Fisher–Yates shuffle, then take `count`.
export function assignNames(count: number): string[] {
  if (count > NAME_POOL.length)
    throw new Error(`requested ${count} names but pool holds ${NAME_POOL.length}`);
  const pool = [...NAME_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
