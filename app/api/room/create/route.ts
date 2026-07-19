import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { redis, keys, ROOM_TTL_SEC } from "@/lib/redis";
import { newRoomCode } from "@/lib/codes";
import { saveRoom, savePlayer } from "@/lib/game";
import type { Room, Player, GameSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampSettings(input: any): GameSettings {
  const maxPlayers = Math.min(10, Math.max(3, Number(input?.maxPlayers) || 10));
  const killers = input?.killers === 2 ? 2 : 1;
  const healer = input?.healer !== false;
  const rawTimer = Number(input?.actionTimerSec);
  const actionTimerSec = Number.isFinite(rawTimer)
    ? Math.min(120, Math.max(0, rawTimer))
    : 60;
  const ghostVotes = input?.ghostVotes === true;
  return { maxPlayers, killers, healer, actionTimerSec, ghostVotes };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim().slice(0, 20);
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  // find an unused code
  let code = newRoomCode();
  for (let i = 0; i < 5; i++) {
    const exists = await redis().exists(keys.room(code));
    if (!exists) break;
    code = newRoomCode();
  }

  const hostToken = nanoid();
  const settings = clampSettings(body?.settings);

  const room: Room = {
    code,
    hostToken,
    phase: "lobby",
    round: 0,
    settings,
    createdAt: Date.now(),
  };

  const host: Player = {
    token: hostToken,
    name,
    role: "villager",
    alive: true,
    connected: true,
    joinedAt: Date.now(),
  };

  await saveRoom(room);
  await savePlayer(code, host);
  await redis().rpush(keys.order(code), hostToken);
  await redis().expire(keys.order(code), ROOM_TTL_SEC);

  return NextResponse.json({ code, token: hostToken });
}
