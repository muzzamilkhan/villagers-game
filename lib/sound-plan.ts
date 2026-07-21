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
