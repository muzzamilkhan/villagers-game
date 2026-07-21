import type { SimConfig, PlayerView } from "./types";

const DEFAULT_URL = "https://villagers-game-pied.vercel.app/";

const PLAYER_VIEWS: PlayerView[] = [
  "spectator", "host", "random", "killer", "healer", "villager",
];

function minPlayersToStart(killers: number): number {
  return 2 * killers + 2;
}

// Tiny flag parser: `--flag value` for valued flags, `--flag` / `--no-flag`
// for booleans. Unknown flags throw.
export function parseArgs(argv: string[]): SimConfig {
  let bots = 8;
  let killers: 1 | 2 = 1;
  let healer = true;
  let ghostVotes = false;
  let maxPlayers: number | undefined;
  let url = DEFAULT_URL;
  const players: PlayerView[] = [];
  let games = 1;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} requires a value`);
      return v;
    };
    switch (a) {
      case "--bots": bots = Number(next()); break;
      case "--killers": {
        const k = Number(next());
        if (k !== 1 && k !== 2) throw new Error("--killers must be 1 or 2");
        killers = k;
        break;
      }
      case "--healer": healer = true; break;
      case "--no-healer": healer = false; break;
      case "--ghost-votes": ghostVotes = true; break;
      case "--no-ghost-votes": ghostVotes = false; break;
      case "--max-players": maxPlayers = Number(next()); break;
      case "--url": url = next(); break;
      case "--games": games = Number(next()); break;
      case "--player": {
        const raw = next();
        const values = raw.split(",").map((s) => s.trim()).filter(Boolean);
        for (const v of values) {
          if (!PLAYER_VIEWS.includes(v as PlayerView))
            throw new Error(`--player must be one of ${PLAYER_VIEWS.join(", ")}`);
          players.push(v as PlayerView);
        }
        break;
      }
      default: throw new Error(`unknown flag: ${a}`);
    }
  }

  const min = minPlayersToStart(killers);
  if (!Number.isInteger(bots) || bots < min)
    throw new Error(`--bots must be at least ${min} for ${killers} killer(s)`);
  if (bots > 10) throw new Error("--bots must be at most 10");

  if (maxPlayers === undefined) maxPlayers = Math.max(bots, min);
  if (maxPlayers < bots) throw new Error("--max-players must be >= --bots");
  if (maxPlayers > 10) throw new Error("--max-players must be at most 10");

  if (players.length === 0) players.push("spectator");

  if (players.includes("healer") && !healer)
    throw new Error("--player healer requires a healer in the game (drop --no-healer)");

  if (!Number.isInteger(games) || games < 1)
    throw new Error("--games must be a positive integer");

  return { bots, killers, healer, ghostVotes, maxPlayers, url, players, games };
}
