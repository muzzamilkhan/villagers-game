import { redis, keys, ROOM_TTL_SEC } from "./redis";
import type {
  Room,
  Player,
  GameSettings,
  ClientState,
  PublicPlayer,
  Role,
} from "./types";

// ---------- room + player io ----------

export async function getRoom(code: string): Promise<Room | null> {
  const raw = await redis().get(keys.room(code));
  return raw ? (JSON.parse(raw) as Room) : null;
}

export async function saveRoom(room: Room): Promise<void> {
  const r = redis();
  await r.set(keys.room(room.code), JSON.stringify(room), "EX", ROOM_TTL_SEC);
  await r.expire(keys.players(room.code), ROOM_TTL_SEC);
  await r.expire(keys.order(room.code), ROOM_TTL_SEC);
}

export async function getPlayers(code: string): Promise<Player[]> {
  const [map, order] = await Promise.all([
    redis().hgetall(keys.players(code)),
    redis().lrange(keys.order(code), 0, -1),
  ]);
  const players = Object.values(map).map((v) => JSON.parse(v) as Player);
  const rank = new Map(order.map((t, i) => [t, i]));
  players.sort(
    (a, b) => (rank.get(a.token) ?? 0) - (rank.get(b.token) ?? 0)
  );
  return players;
}

export async function getPlayer(
  code: string,
  token: string
): Promise<Player | null> {
  const raw = await redis().hget(keys.players(code), token);
  return raw ? (JSON.parse(raw) as Player) : null;
}

export async function savePlayer(code: string, player: Player): Promise<void> {
  await redis().hset(keys.players(code), player.token, JSON.stringify(player));
}

export async function removePlayer(code: string, token: string): Promise<void> {
  const r = redis();
  await r.hdel(keys.players(code), token);
  await r.lrem(keys.order(code), 0, token);
  await r.hdel(keys.actions(code), token);
  await r.hdel(keys.votes(code), token);
}

// ---------- role assignment ----------

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function assignRoles(
  players: Player[],
  settings: GameSettings
): Player[] {
  const tokens = shuffle(players.map((p) => p.token));
  const roleByToken = new Map<string, Role>();
  let i = 0;
  for (let k = 0; k < settings.killers && i < tokens.length; k++, i++) {
    roleByToken.set(tokens[i], "killer");
  }
  if (settings.healer && i < tokens.length) {
    roleByToken.set(tokens[i], "healer");
    i++;
  }
  return players.map((p) => ({
    ...p,
    role: roleByToken.get(p.token) ?? "villager",
    alive: true,
  }));
}

// ---------- resolution ----------

// Night: killers share one kill. We take the majority kill target among
// killers; ties (2 killers disagree) resolve to no kill. Healer save cancels it.
export async function resolveNight(code: string, room: Room): Promise<Room> {
  const [players, actions] = await Promise.all([
    getPlayers(code),
    redis().hgetall(keys.actions(code)),
  ]);
  const byToken = new Map(players.map((p) => [p.token, p]));

  const killTargets: string[] = [];
  let healTarget: string | undefined;
  for (const [actor, target] of Object.entries(actions)) {
    const p = byToken.get(actor);
    if (!p || !p.alive) continue;
    if (p.role === "killer") killTargets.push(target);
    if (p.role === "healer") healTarget = target;
  }

  // Shared kill: all killers must agree on the same target.
  let victim: string | undefined;
  if (killTargets.length > 0) {
    const allAgree = killTargets.every((t) => t === killTargets[0]);
    if (allAgree) victim = killTargets[0];
  }

  // Healer cannot save the same person two nights running.
  const healBlocked = healTarget && healTarget === room.lastHealTarget;
  const effectiveHeal = healBlocked ? undefined : healTarget;

  let announcement: string;
  if (!victim) {
    announcement = "The village awoke to a quiet dawn. No one was harmed.";
  } else if (effectiveHeal === victim) {
    const name = byToken.get(victim)?.name ?? "someone";
    announcement = `${name} was attacked in the night… but the healer's hand kept them alive.`;
  } else {
    const p = byToken.get(victim);
    if (p) {
      p.alive = false;
      await savePlayer(code, p);
      announcement = `${p.name} was slain in the night.`;
    } else {
      announcement = "A shadow passed, but the village stands.";
    }
  }

  room.announcement = announcement;
  room.lastHealTarget = effectiveHeal;
  room.phase = "resolve";
  await redis().del(keys.actions(code));
  await saveRoom(room);
  return checkWin(code, room);
}

// Day: plurality vote. Ties → no elimination.
export async function resolveVote(code: string, room: Room): Promise<Room> {
  const [players, votes] = await Promise.all([
    getPlayers(code),
    redis().hgetall(keys.votes(code)),
  ]);
  const byToken = new Map(players.map((p) => [p.token, p]));

  const tally = new Map<string, number>();
  for (const [voter, target] of Object.entries(votes)) {
    const v = byToken.get(voter);
    if (!v) continue;
    // Dead players count only when ghost-voting is enabled for the room.
    if (!v.alive && !room.settings.ghostVotes) continue;
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }

  let top: string | undefined;
  let topCount = 0;
  let tie = false;
  for (const [target, count] of tally) {
    if (count > topCount) {
      top = target;
      topCount = count;
      tie = false;
    } else if (count === topCount) {
      tie = true;
    }
  }

  let result: string;
  if (!top || tie || topCount === 0) {
    result = "The village could not agree. No one was cast out.";
  } else {
    const p = byToken.get(top);
    if (p) {
      p.alive = false;
      await savePlayer(code, p);
      const wasKiller = p.role === "killer";
      result = wasKiller
        ? `${p.name} was cast out — and was indeed a killer!`
        : `${p.name} was cast out — but was innocent.`;
    } else {
      result = "The accused was already gone.";
    }
  }

  room.voteResult = result;
  room.phase = "day_result";
  await redis().del(keys.votes(code));
  await saveRoom(room);
  return checkWin(code, room);
}

// ---------- win detection ----------

export async function checkWin(code: string, room: Room): Promise<Room> {
  const players = await getPlayers(code);
  const living = players.filter((p) => p.alive);
  const killers = living.filter((p) => p.role === "killer").length;
  const others = living.length - killers;

  if (killers === 0) {
    room.winner = "villagers";
    room.phase = "game_over";
    await saveRoom(room);
  } else if (killers >= others) {
    room.winner = "killers";
    room.phase = "game_over";
    await saveRoom(room);
  }
  return room;
}

// ---------- phase advancement ----------

export async function advancePhase(code: string, room: Room): Promise<Room> {
  switch (room.phase) {
    case "resolve":
      room.phase = "day_vote";
      await saveRoom(room);
      return room;
    case "day_result":
      room.round += 1;
      room.phase = "night_action";
      room.announcement = undefined;
      room.voteResult = undefined;
      await saveRoom(room);
      return room;
    default:
      return room;
  }
}

// ---------- per-player client view ----------

export async function buildClientState(
  code: string,
  viewerToken: string
): Promise<ClientState | null> {
  const room = await getRoom(code);
  if (!room) return null;
  const players = await getPlayers(code);
  const you = players.find((p) => p.token === viewerToken);
  if (!you) return null;

  const viewerIsKiller = you.role === "killer";

  const publicPlayers: PublicPlayer[] = players.map((p) => {
    const revealRole =
      room.phase === "game_over" || // reveal all at the end
      p.token === viewerToken ||
      (viewerIsKiller && p.role === "killer"); // killers know each other
    return {
      token: p.token,
      name: p.name,
      alive: p.alive,
      connected: p.connected,
      isHost: p.token === room.hostToken,
      role: revealRole ? p.role : undefined,
    };
  });

  const scratchKey =
    room.phase === "night_action"
      ? keys.actions(code)
      : room.phase === "day_vote"
        ? keys.votes(code)
        : null;

  const livingTokens = new Set(
    players.filter((p) => p.alive).map((p) => p.token)
  );
  const ghostDayVote = room.phase === "day_vote" && room.settings.ghostVotes;
  // Who may submit this phase: living players always, plus ghosts during the
  // day when the host enabled ghost votes.
  const eligibleTokens = ghostDayVote
    ? new Set(players.map((p) => p.token))
    : livingTokens;

  let submitted = false;
  let yourPick: string | undefined;
  let submittedCount = 0;
  let voterCount = livingTokens.size;
  let liveVotes: Record<string, string> | undefined;
  if (scratchKey) {
    const [mine, all] = await Promise.all([
      redis().hget(scratchKey, viewerToken),
      redis().hgetall(scratchKey),
    ]);
    yourPick = mine ?? undefined;
    submitted = mine != null;
    submittedCount = Object.keys(all).filter((t) =>
      eligibleTokens.has(t)
    ).length;
    voterCount = eligibleTokens.size;

    // Day votes are public: expose the live tally to everyone so votes can
    // sway toward a majority before the host locks in. Night actions are
    // secret and are never surfaced here. Targets are always living players;
    // voters include ghosts when ghost-voting is on.
    if (room.phase === "day_vote") {
      liveVotes = {};
      for (const [voter, target] of Object.entries(all)) {
        if (eligibleTokens.has(voter) && livingTokens.has(target)) {
          liveVotes[voter] = target;
        }
      }
    }
  }

  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    settings: room.settings,
    you: {
      token: you.token,
      name: you.name,
      role: you.role,
      alive: you.alive,
      isHost: you.token === room.hostToken,
    },
    players: publicPlayers,
    submitted,
    yourPick,
    submittedCount,
    livingCount: livingTokens.size,
    voterCount,
    liveVotes,
    announcement: room.announcement,
    voteResult: room.voteResult,
    winner: room.winner,
  };
}
