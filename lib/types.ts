export type Role = "villager" | "killer" | "healer";

export type Phase =
  | "lobby"
  | "night_action"
  | "resolve"
  | "day_vote"
  | "day_result"
  | "game_over";

export interface GameSettings {
  maxPlayers: number; // up to 10
  killers: number; // 1 or 2
  healer: boolean;
  actionTimerSec: number; // night action countdown, 0 = no timer
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
  // resolution announcement for the current round
  announcement?: string;
  // outcome of the last day vote
  voteResult?: string;
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
  // how many living players have submitted (for host progress)
  submittedCount: number;
  livingCount: number;
  announcement?: string;
  voteResult?: string;
  winner?: "villagers" | "killers";
}
