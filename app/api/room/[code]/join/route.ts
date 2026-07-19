import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { redis, keys, publish, ROOM_TTL_SEC } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import { getRoom, getPlayers, savePlayer } from "@/lib/game";
import type { Player } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = normalizeCode((await params).code);
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim().slice(0, 20);
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const room = await getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  if (room.phase !== "lobby") {
    return NextResponse.json(
      { error: "This game has already started." },
      { status: 409 }
    );
  }

  const players = await getPlayers(code);
  if (players.length >= room.settings.maxPlayers) {
    return NextResponse.json({ error: "Game is full." }, { status: 409 });
  }
  if (
    players.some((p) => p.name.toLowerCase() === name.toLowerCase())
  ) {
    return NextResponse.json(
      { error: "That name is taken." },
      { status: 409 }
    );
  }

  const token = nanoid();
  const player: Player = {
    token,
    name,
    role: "villager",
    alive: true,
    connected: true,
    joinedAt: Date.now(),
  };

  await savePlayer(code, player);
  await redis().rpush(keys.order(code), token);
  await redis().expire(keys.order(code), ROOM_TTL_SEC);
  await publish(code);

  return NextResponse.json({ code, token });
}
