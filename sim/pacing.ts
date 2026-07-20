const MIN_MS = 2000;
const MAX_MS = 8000;

export function humanDelayMs(): number {
  return MIN_MS + Math.floor(Math.random() * (MAX_MS - MIN_MS + 1));
}

export function humanPause(): Promise<void> {
  return new Promise((r) => setTimeout(r, humanDelayMs()));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
