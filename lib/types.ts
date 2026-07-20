export type Role = "villager" | "killer" | "healer";

export type Phase =
  | "lobby"
  | "night_action"
  | "resolve"
  | "day_vote"
  | "day_result"
  | "game_over";

// A single thing that happened at a resolution, sent structured so the client
// can compose the sentence and style the important words. Carries only player
// NAMES (already public) — never roles.
export type OutcomeEvent =
  | { type: "kill"; player: string }
  | { type: "save"; player: string }
  | { type: "quiet" }
  | { type: "castout_killer"; player: string }
  | { type: "castout_innocent"; player: string }
  | { type: "no_agreement" };

export interface GameSettings {
  maxPlayers: number; // up to 10
  killers: number; // 1 or 2
  healer: boolean;
  actionTimerSec: number; // night action countdown, 0 = no timer
  ghostVotes: boolean; // dead players may still cast a day vote
}

// Fewest players a game may start with, scaled to the killer count. Killers win
// the moment `killers >= other living players` (see checkWin), so the villagers
// need a real cushion: we require the non-killers to outnumber the killers by at
// least 2 at kickoff (total ≥ 2·killers + 2). That keeps the game from being
// won — or nearly won — before the first night. For the common 1-killer game
// this is 4; for 2 killers it's 6.
export function minPlayersToStart(settings: GameSettings): number {
  return 2 * settings.killers + 2;
}

export interface Player {
  token: string; // private, stored client-side
  name: string;
  role: Role;
  alive: boolean;
  connected: boolean;
  joinedAt: number;
}

export interface Room {
  code: string;
  hostToken: string;
  phase: Phase;
  round: number;
  settings: GameSettings;
  createdAt: number;
  // per-round scratch
  lastHealTarget?: string; // token healed last night (block repeat)
  // structured resolution outcome for the current round (client composes text)
  nightOutcome?: OutcomeEvent[];
  // structured outcome of the last day vote
  dayOutcome?: OutcomeEvent[];
  // per-game shuffled 0..9 sequence; indexes the ambient narration pools by
  // round so every player + the observer see the same flavor line each round.
  narrationSeq?: number[];
  // set when the game ends
  winner?: "villagers" | "killers";
}

// What a single player is allowed to see. Roles of others are hidden
// unless the viewer is a killer (killers know each other).
export interface PublicPlayer {
  token: string;
  name: string;
  alive: boolean;
  connected: boolean;
  isHost: boolean;
  // only populated for the viewer themselves, or fellow killers
  role?: Role;
}

export interface ClientState {
  code: string;
  phase: Phase;
  round: number;
  settings: GameSettings;
  // True when this stream is a passive observer (big-screen projection), not a
  // player. Observers never see hidden roles and can't act; `you` is a synthetic
  // placeholder in that case.
  observer: boolean;
  you: {
    token: string;
    name: string;
    role: Role;
    alive: boolean;
    isHost: boolean;
  };
  players: PublicPlayer[];
  // whether the viewer has locked their action/vote this round
  submitted: boolean;
  // your current pick this round (action or vote), if any
  yourPick?: string;
  // how many eligible players have submitted (for host progress)
  submittedCount: number;
  livingCount: number;
  // players eligible to submit this phase (living, plus ghosts when
  // ghost-voting is on during the day) — the progress denominator
  voterCount: number;
  // day_vote only: public running tally, voter token → target token.
  // Lets everyone see who's voting for whom before the host locks it in.
  // Never populated at night — night actions stay secret.
  liveVotes?: Record<string, string>;
  nightOutcome?: OutcomeEvent[];
  dayOutcome?: OutcomeEvent[];
  narrationSeq?: number[];
  winner?: "villagers" | "killers";
}
