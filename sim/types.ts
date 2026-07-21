export type PlayerView =
  | "spectator" | "host" | "random" | "killer" | "healer" | "villager";

export interface SimConfig {
  bots: number;
  killers: 1 | 2;
  healer: boolean;
  ghostVotes: boolean;
  maxPlayers: number;
  url: string;
  players: PlayerView[];
  // How many games to play back-to-back in the same room. Between games the host
  // clicks "New game" (games - 1 times); after the final game the host clicks
  // "End game", wiping the room. Default 1 (a single game, then End game).
  games: number;
}

export type Role = "villager" | "killer" | "healer";

// Minimal view of one player as a bot sees it on its own screen.
export interface SeenPlayer {
  name: string;
  alive: boolean;
}
