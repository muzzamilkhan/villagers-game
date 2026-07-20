export interface SimConfig {
  bots: number;
  killers: 1 | 2;
  healer: boolean;
  ghostVotes: boolean;
  maxPlayers: number;
  url: string;
}

export type Role = "villager" | "killer" | "healer";

// Minimal view of one player as a bot sees it on its own screen.
export interface SeenPlayer {
  name: string;
  alive: boolean;
}
