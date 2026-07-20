import type { SimConfig } from "./types.ts";

const DEFAULT_URL = "https://villagers-game-pied.vercel.app/";

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

  return { bots, killers, healer, ghostVotes, maxPlayers, url };
}
