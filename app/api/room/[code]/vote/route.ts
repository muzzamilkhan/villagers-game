import { NextRequest, NextResponse } from "next/server";
import { redis, keys, publish, ROOM_TTL_SEC } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import { getRoom, getPlayer } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = normalizeCode((await params).code);
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? "");
  const target = String(body?.target ?? "");

  const room = await getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  if (room.phase !== "day_vote") {
    return NextResponse.json({ error: "Not the voting phase." }, { status: 409 });
  }

  const me = await getPlayer(code, token);
  // Ghosts may vote only when the host enabled it, and never if they were a
  // killer — a dead killer's vote would just help their side from the grave.
  if (
    !me ||
    (!me.alive && (!room.settings.ghostVotes || me.role === "killer"))
  ) {
    return NextResponse.json({ error: "You can't vote." }, { status: 403 });
  }
  const targetPlayer = await getPlayer(code, target);
  if (!targetPlayer || !targetPlayer.alive) {
    return NextResponse.json({ error: "Invalid target." }, { status: 400 });
  }

  // Votes stay editable until the host locks them.
  await redis().hset(keys.votes(code), token, target);
  await redis().expire(keys.votes(code), ROOM_TTL_SEC);
  await publish(code);

  return NextResponse.json({ ok: true });
}
