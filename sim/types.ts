export type PlayerView =
  | "spectator" | "host" | "random" | "killer" | "healer" | "villager";

export interface SimConfig {
  bots: number;
  killers: 1 | 2;
  healer: boolean;
  ghostVotes: boolean;
  maxPlayers: number;
  url: string;
  player: PlayerView;
}

export type Role = "villager" | "killer" | "healer";

// Minimal view of one player as a bot sees it on its own screen.
export interface SeenPlayer {
  name: string;
  alive: boolean;
}
